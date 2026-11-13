//! Local heuristic rules for text message analysis.

use crate::models::RuleHit;
use crate::url_rules::evaluate_url_rules;
use url::Url;

/// Evaluates message text for phishing indicators and embedded URLs.
pub fn evaluate_message_rules(text: &str) -> Vec<RuleHit> {
    let mut hits = Vec::new();
    let lower = text.to_lowercase();

    // Rule 1: Urgency indicators (+2 points)
    let urgency_phrases = [
        "within 24 hours",
        "immediately",
        "urgent",
        "24 hours",
        "asap",
        "act now",
    ];
    if urgency_phrases.iter().any(|p| lower.contains(p)) {
        hits.push(RuleHit::new(
            "urgency_language",
            "Urgent time window or pressure tactic detected",
            2,
        ));
    }

    // Rule 2: Suspension or threat language (+3 points)
    let suspension_phrases = [
        "prevent suspension",
        "suspend",
        "locked",
        "terminated",
        "restricted",
        "unauthorized activity",
    ];
    if suspension_phrases.iter().any(|p| lower.contains(p)) {
        hits.push(RuleHit::new(
            "suspension_threat",
            "Account suspension threat or penalty warning",
            3,
        ));
    }

    // Rule 3: Action request (+1 point)
    let action_phrases = [
        "review your",
        "click here",
        "confirm",
        "action required",
        "log in to",
        "update your",
    ];
    if action_phrases.iter().any(|p| lower.contains(p)) {
        hits.push(RuleHit::new(
            "action_request",
            "Vague or unsolicited action request",
            1,
        ));
    }

    // Rule 4: Mentions account / security credentials (+1 point)
    if lower.contains("account")
        || lower.contains("security settings")
        || lower.contains("credentials")
    {
        hits.push(RuleHit::new(
            "account_reference",
            "Message references user account or security credentials",
            1,
        ));
    }

    // Rule 5: Embedded URLs (reuse URL rules)
    for word in text.split_whitespace() {
        if word.starts_with("http://") || word.starts_with("https://") {
            let clean_link = word.trim_end_matches(&['.', ',', ';', '!', '?'][..]);
            if let Ok(parsed) = Url::parse(clean_link) {
                let url_hits = evaluate_url_rules(&parsed);
                for uh in url_hits {
                    hits.push(RuleHit::new(
                        format!("embedded_{}", uh.id),
                        format!("Embedded URL: {}", uh.description),
                        uh.points,
                    ));
                }
            } else {
                hits.push(RuleHit::new(
                    "embedded_malformed_link",
                    "Contains unparseable or obfuscated embedded link",
                    3,
                ));
            }
        }
    }

    hits
}
