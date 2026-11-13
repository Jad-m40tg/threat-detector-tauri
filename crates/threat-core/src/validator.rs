//! Input validation and type detection module.

use crate::error::ThreatError;
use crate::models::InputType;

pub const MAX_URL_LENGTH: usize = 2048;
pub const MAX_MESSAGE_LENGTH: usize = 4096;

/// Automatically detects whether the input string is a URL or a text message.
///
/// Rules:
/// - Leading http://, https://, or www. -> URL
/// - Contains no whitespace and has a valid hostname dot-structure -> URL
/// - Otherwise -> Message
pub fn detect_input_type(raw: &str) -> InputType {
    let trimmed = raw.trim();
    if trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("www.")
    {
        return InputType::Url;
    }

    if !trimmed.contains(char::is_whitespace) && trimmed.contains('.') && !trimmed.ends_with('.') {
        return InputType::Url;
    }

    InputType::Message
}

/// Validates raw input string according to size limits and non-emptiness.
pub fn validate_input(raw: &str, input_type: InputType) -> Result<String, ThreatError> {
    let clean = raw.trim_start_matches('\u{feff}').trim();
    if clean.is_empty() {
        return Err(ThreatError::EmptyInput);
    }

    let max_len = match input_type {
        InputType::Url => MAX_URL_LENGTH,
        InputType::Message => MAX_MESSAGE_LENGTH,
    };

    if clean.len() > max_len {
        return Err(ThreatError::OversizedInput {
            length: clean.len(),
            max: max_len,
        });
    }

    Ok(clean.to_string())
}
