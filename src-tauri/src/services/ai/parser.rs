//! Defensive parsing of provider replies plus the verdict-consistency guard.

use serde_json::Value;

use super::types::AiError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedOverview {
    pub headline: String,
    pub summary: String,
    pub explanation: String,
    pub tips: Vec<String>,
}

fn bad(message: &str) -> AiError {
    AiError::new("BadResponse", message)
}

fn strip_code_fences(raw: &str) -> &str {
    let trimmed = raw.trim();
    if !trimmed.starts_with("```") {
        return trimmed;
    }
    let inner = match trimmed.find('\n') {
        Some(index) => &trimmed[index + 1..],
        None => "",
    };
    inner.trim().strip_suffix("```").unwrap_or(inner).trim()
}

fn strip_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for ch in text.chars() {
        if in_tag {
            if ch == '>' {
                in_tag = false;
            }
        } else if ch == '<' {
            in_tag = true;
        } else {
            out.push(ch);
        }
    }
    out
}

fn clean(text: &str, max: usize) -> String {
    let without_html = strip_html(text);
    let without_control: String = without_html
        .chars()
        .filter(|c| !c.is_control() || c.is_whitespace())
        .collect();
    let collapsed = without_control
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    collapsed.chars().take(max).collect()
}

/// Parses the provider reply, ignoring extra keys and tolerating code fences.
pub fn parse_overview(raw: &str) -> Result<ParsedOverview, AiError> {
    let text = strip_code_fences(raw);
    let start = text
        .find('{')
        .ok_or_else(|| bad("The AI answer was not valid JSON."))?;
    let end = text
        .rfind('}')
        .ok_or_else(|| bad("The AI answer was not valid JSON."))?;
    if end <= start {
        return Err(bad("The AI answer was not valid JSON."));
    }
    let value: Value = serde_json::from_str(&text[start..=end])
        .map_err(|_| bad("The AI answer was not valid JSON."))?;

    let headline = clean(text_of(&value, "headline"), 60);
    let summary = clean(text_of(&value, "summary"), 140);
    let explanation = clean(text_of(&value, "explanation"), 400);
    if headline.is_empty() || summary.is_empty() || explanation.is_empty() {
        return Err(bad("The AI answer was incomplete."));
    }

    let mut tips = Vec::new();
    if let Some(items) = value.get("tips").and_then(Value::as_array) {
        for item in items.iter().take(3) {
            if let Some(tip) = item.as_str() {
                let tip = clean(tip, 100);
                if !tip.is_empty() {
                    tips.push(tip);
                }
            }
        }
    }
    if tips.is_empty() {
        return Err(bad("The AI answer had no tips."));
    }

    Ok(ParsedOverview {
        headline,
        summary,
        explanation,
        tips,
    })
}

fn text_of<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

fn claims_risk_free(text: &str) -> bool {
    let lower = text.to_lowercase();
    if lower.contains("no risk")
        || lower.contains("risk-free")
        || lower.contains("risk free")
        || lower.contains("zero risk")
    {
        return true;
    }
    let tokens: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .collect();
    tokens
        .iter()
        .enumerate()
        .any(|(index, token)| *token == "safe" && (index == 0 || tokens[index - 1] != "not"))
}

/// The provider may not call an item safe unless the scanner verdict is
/// Low plus Verified. `NotVerified` can never be described as safe.
pub fn enforce_consistency(
    overview: &ParsedOverview,
    risk_level: &str,
    status: &str,
) -> Result<(), AiError> {
    let allowed = risk_level.eq_ignore_ascii_case("low") && status.eq_ignore_ascii_case("verified");
    if allowed {
        return Ok(());
    }
    let all_text = [
        overview.headline.as_str(),
        overview.summary.as_str(),
        overview.explanation.as_str(),
    ]
    .into_iter()
    .chain(overview.tips.iter().map(String::as_str))
    .any(claims_risk_free);
    if all_text {
        return Err(AiError::new(
            "Rejected",
            "The AI answer did not match the scanner verdict.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed() -> ParsedOverview {
        ParsedOverview {
            headline: "High-risk indicators".into(),
            summary: "Strong phishing patterns were found.".into(),
            explanation: "The scanner rated this item High.".into(),
            tips: vec!["Do not open it.".into()],
        }
    }

    #[test]
    fn accepts_valid_json() {
        let raw = r#"{"headline":"High-risk indicators","summary":"Strong patterns.","explanation":"The scanner rated this High.","tips":["Avoid it.","Report it."],"extra":"ignored"}"#;
        let p = parse_overview(raw).expect("valid");
        assert_eq!(p.tips.len(), 2);
        assert_eq!(p.headline, "High-risk indicators");
    }

    #[test]
    fn accepts_fenced_json() {
        let raw = "```json\n{\"headline\":\"h\",\"summary\":\"s\",\"explanation\":\"e\",\"tips\":[\"t\"]}\n```";
        assert!(parse_overview(raw).is_ok());
    }

    #[test]
    fn rejects_missing_fields() {
        let raw = r#"{"headline":"h","tips":["t"]}"#;
        assert_eq!(
            parse_overview(raw).err().map(|e| e.code),
            Some("BadResponse".to_string())
        );
    }

    #[test]
    fn truncates_overlong_values() {
        let raw = format!(
            r#"{{"headline":"{}","summary":"{}","explanation":"{}","tips":["{}"]}}"#,
            "H".repeat(90),
            "S".repeat(200),
            "E".repeat(500),
            "T".repeat(200)
        );
        let p = parse_overview(&raw).expect("valid");
        assert_eq!(p.headline.chars().count(), 60);
        assert_eq!(p.summary.chars().count(), 140);
        assert_eq!(p.explanation.chars().count(), 400);
        assert_eq!(p.tips[0].chars().count(), 100);
    }

    #[test]
    fn strips_html_and_control_chars() {
        let raw = r#"{"headline":"<b>Hi</b>","summary":"a\u0007b","explanation":"e","tips":["t"]}"#;
        let p = parse_overview(raw).expect("valid");
        assert_eq!(p.headline, "Hi");
        assert_eq!(p.summary, "ab");
    }

    #[test]
    fn guard_rejects_safe_claim_for_high() {
        let mut p = parsed();
        p.explanation = "Overall this looks safe to open.".into();
        let err = enforce_consistency(&p, "high", "verified").expect_err("must reject");
        assert_eq!(err.code, "Rejected");
    }

    #[test]
    fn guard_rejects_no_risk_for_not_verified() {
        let mut p = parsed();
        p.summary = "No risk was found.".into();
        assert!(enforce_consistency(&p, "not_verified", "not_verified").is_err());
    }

    #[test]
    fn guard_allows_safe_for_low_verified() {
        let mut p = parsed();
        p.explanation = "Few indicators; this looks safe, but stay alert.".into();
        assert!(enforce_consistency(&p, "low", "verified").is_ok());
    }

    #[test]
    fn guard_allows_negative_safe_statement() {
        let mut p = parsed();
        p.explanation = "This is not safe; treat it as hostile.".into();
        assert!(enforce_consistency(&p, "high", "verified").is_ok());
    }
}
