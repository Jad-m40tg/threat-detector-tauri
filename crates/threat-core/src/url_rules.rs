//! Local heuristic rules for URL analysis.
//!
//! Evaluates URL structure offline without fetching or DNS resolution.

use crate::models::RuleHit;
use url::Url;

/// A URL longer than this many characters (full text) adds a small suspicion hit.
const SUSPICIOUS_URL_LENGTH: usize = 100;

/// Well-known URL-shortener domains. Matches the host itself or a subdomain of it.
const SHORTENER_HOSTS: [&str; 10] = [
    "bit.ly",
    "tinyurl.com",
    "goo.gl",
    "t.co",
    "is.gd",
    "cutt.ly",
    "rb.gy",
    "ow.ly",
    "buff.ly",
    "rebrand.ly",
];

/// Evaluates URL rules against a parsed URL.
pub fn evaluate_url_rules(parsed_url: &Url) -> Vec<RuleHit> {
    let mut hits = Vec::new();

    // Rule 1: HTTP protocol (insecure)
    if parsed_url.scheme() == "http" {
        hits.push(RuleHit::new(
            "http_protocol",
            "Uses unencrypted HTTP protocol",
            2,
        ));
    }

    if let Some(host) = parsed_url.host_str() {
        let host_lower = host.to_lowercase();
        let is_ip_host = host.parse::<std::net::IpAddr>().is_ok();

        // Rule 2: IP address hostname
        if is_ip_host {
            hits.push(RuleHit::new(
                "ip_host",
                "Hostname is a raw IP address instead of a domain name",
                4,
            ));
        }

        // Rule 3: Authority contains @ symbol (credential or auth trick)
        if !parsed_url.username().is_empty() || parsed_url.password().is_some() {
            hits.push(RuleHit::new(
                "authority_userinfo",
                "Contains @ symbol in authority section (user credentials spoofing)",
                4,
            ));
        }

        // Rule 4: Misleading or nested subdomains.
        // Skipped for raw IP hosts: their four dot-separated octets are not subdomains.
        if !is_ip_host {
            let parts: Vec<&str> = host.split('.').collect();
            if parts.len() >= 4 {
                hits.push(RuleHit::new(
                    "nested_subdomains",
                    "Multiple nested subdomains and misleading domain structure",
                    3,
                ));
            }
        }

        // Rule 5: Suspicious host keywords (points capped at 3)
        let suspicious_keywords = [
            "portal", "login", "account", "verify", "secure", "update", "bank",
        ];
        let mut keyword_hits = 0;
        for kw in suspicious_keywords {
            if host_lower.contains(kw) {
                keyword_hits += 1;
            }
        }
        if keyword_hits > 0 {
            hits.push(RuleHit::new(
                "suspicious_keyword",
                format!("Hostname contains {} suspicious keyword(s)", keyword_hits),
                (keyword_hits as u32).min(3),
            ));
        }

        // Rule 6: Punycode host (possible lookalike domain, e.g. xn--pple-43d.com).
        // The `url` crate already converts internationalized domains to punycode,
        // so a Unicode lookalike also lands here.
        if host_lower.contains("xn--") {
            hits.push(RuleHit::new(
                "punycode_host",
                "Hostname uses punycode encoding (possible lookalike domain)",
                4,
            ));
        }

        // Rule 7: Very long URL (padding can hide the real destination)
        if parsed_url.as_str().len() > SUSPICIOUS_URL_LENGTH {
            hits.push(RuleHit::new(
                "long_url",
                "Unusually long URL (possible padding to hide the real destination)",
                1,
            ));
        }

        // Rule 8: URL shortener
        if is_shortener_host(&host_lower) {
            hits.push(RuleHit::new(
                "shortener_host",
                "Routes through a URL shortener that can hide the real destination",
                3,
            ));
        }

        // Rule 9: Non-standard port (e.g. http://example.com:8080/).
        // The standard port for a well-known scheme never fires; for an
        // unknown scheme, any explicit port counts as non-standard.
        if let Some(port) = parsed_url.port() {
            let standard = match parsed_url.scheme() {
                "http" | "ws" => port == 80,
                "https" | "wss" => port == 443,
                "ftp" => port == 21,
                _ => false,
            };
            if !standard {
                hits.push(RuleHit::new(
                    "nonstandard_port",
                    "Uses a non-standard network port",
                    1,
                ));
            }
        }
    }

    hits
}

/// True when `host` is a known shortener domain or a subdomain of one.
fn is_shortener_host(host: &str) -> bool {
    for entry in SHORTENER_HOSTS {
        if host == entry || host.ends_with(&format!(".{}", entry)) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use url::Url;

    fn hit_ids(url: &str) -> Vec<String> {
        let parsed = Url::parse(url).expect("test URL must parse");
        evaluate_url_rules(&parsed)
            .into_iter()
            .map(|h| h.id)
            .collect()
    }

    #[test]
    fn http_flagged_https_not() {
        let http = hit_ids("http://example.com/page");
        assert!(http.contains(&"http_protocol".to_string()));
        let https = hit_ids("https://example.com/page");
        assert!(!https.contains(&"http_protocol".to_string()));
    }

    #[test]
    fn ip_host_flagged_and_not_nested() {
        // Regression: the four octets of an IP must NOT count as nested subdomains.
        let ids = hit_ids("http://192.168.1.50/portal/update");
        assert!(ids.contains(&"ip_host".to_string()));
        assert!(!ids.contains(&"nested_subdomains".to_string()));
    }

    #[test]
    fn nested_subdomains_on_domains_only() {
        let ids = hit_ids("http://brand.account-security.example-portal.net/login");
        assert!(ids.contains(&"nested_subdomains".to_string()));
    }

    #[test]
    fn userinfo_at_flagged() {
        let ids = hit_ids("http://user:token@secure-portal.net/auth");
        assert!(ids.contains(&"authority_userinfo".to_string()));
    }

    #[test]
    fn punycode_flagged() {
        let ids = hit_ids("https://xn--80ak6aa92e.com/");
        assert!(ids.contains(&"punycode_host".to_string()));
    }

    #[test]
    fn long_url_flagged() {
        let long = format!("https://example.com/{}", "a".repeat(150));
        let ids = hit_ids(&long);
        assert!(ids.contains(&"long_url".to_string()));
    }

    #[test]
    fn shortener_flagged_exact_and_subdomain_not_lookalike() {
        assert!(hit_ids("https://bit.ly/abc").contains(&"shortener_host".to_string()));
        assert!(hit_ids("https://www.bit.ly/abc").contains(&"shortener_host".to_string()));
        // "xbit.ly" merely ends with "bit.ly" but is NOT a subdomain of it.
        assert!(!hit_ids("https://xbit.ly/abc").contains(&"shortener_host".to_string()));
    }

    #[test]
    fn nonstandard_port_flagged_default_ports_not() {
        assert!(hit_ids("http://example.com:8080/").contains(&"nonstandard_port".to_string()));
        assert!(!hit_ids("http://example.com:80/").contains(&"nonstandard_port".to_string()));
        assert!(!hit_ids("https://example.com:443/").contains(&"nonstandard_port".to_string()));
    }
}
