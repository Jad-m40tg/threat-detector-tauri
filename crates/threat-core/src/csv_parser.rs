//! Flexible CSV parser for batch analysis.
//!
//! Handles quirks:
//! - Flexible width (extra trailing columns)
//! - BOM stripping
//! - Mixed CRLF/LF line endings
//! - Tolerates row errors without aborting the file
//! - Two recognized dialects (decision D7): the project dataset format
//!   `[id, input_type, content, ...]` and the app's sample format where the
//!   first column is the input itself (type auto-detected per row, D2).
//! - A header row is optional and only consumed when it is recognized;
//!   a headerless file keeps all of its rows.

use crate::error::ThreatError;
use crate::models::{InputType, NotVerifiedReason};
use crate::validator::detect_input_type;
use std::path::Path;

pub const MAX_CSV_SIZE: u64 = 1024 * 1024; // 1 MB
pub const MAX_CSV_ROWS: usize = 5000;

#[derive(Debug, Clone)]
pub struct CsvRowItem {
    pub id: String,
    pub input_type: InputType,
    pub content: String,
    pub row_index: usize,
    pub parse_error: Option<NotVerifiedReason>,
}

/// Parses a CSV file from disk. Applies the size limit before reading and
/// shares the row logic with `parse_csv_text`.
pub fn parse_csv_file(path: impl AsRef<Path>) -> Result<Vec<CsvRowItem>, ThreatError> {
    let path = path.as_ref();
    if !path.exists() {
        return Err(ThreatError::CsvFileError(format!(
            "File does not exist: {}",
            path.display()
        )));
    }

    let meta = std::fs::metadata(path)?;
    if meta.len() == 0 {
        return Err(ThreatError::CsvFileError("CSV file is empty".to_string()));
    }
    if meta.len() > MAX_CSV_SIZE {
        return Err(ThreatError::CsvFileError(format!(
            "CSV file size ({} bytes) exceeds limit ({} bytes)",
            meta.len(),
            MAX_CSV_SIZE
        )));
    }

    let label = path.display().to_string();
    let text = std::fs::read_to_string(path)?;
    parse_rows(&label, &text)
}

/// Parses CSV text supplied directly by the frontend (drag-and-drop,
/// decision D7). Same limits and row logic as `parse_csv_file`.
pub fn parse_csv_text(label: &str, text: &str) -> Result<Vec<CsvRowItem>, ThreatError> {
    if text.is_empty() {
        return Err(ThreatError::CsvFileError(format!(
            "CSV file '{}' is empty",
            label
        )));
    }
    let len = text.len() as u64;
    if len > MAX_CSV_SIZE {
        return Err(ThreatError::CsvFileError(format!(
            "CSV file '{}' size ({} bytes) exceeds limit ({} bytes)",
            label, len, MAX_CSV_SIZE
        )));
    }
    parse_rows(label, text)
}

/// Which CSV column layout a file uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Dialect {
    /// `id,input_type,content,...` — the project dataset format.
    Typed,
    /// First column is the input itself (sample format; type auto-detected).
    Plain,
}

/// Outcome of classifying the first non-blank line of a file.
enum HeaderKind {
    Typed,
    Plain,
    /// Not a header: the line is data of the given dialect.
    Data(Dialect),
}

/// Strips surrounding double quotes from a single CSV field (no inner
/// escaping — this is only used for header detection and plain-dialect ids).
fn unquote(field: &str) -> &str {
    let f = field.trim();
    if f.len() >= 2 && f.starts_with('"') && f.ends_with('"') {
        &f[1..f.len() - 1]
    } else {
        f
    }
}

/// Decides the dialect from the first non-blank line when it looks like a
/// header; otherwise reports the line as data of the sniffed dialect.
fn classify_header(line: &str) -> HeaderKind {
    let fields: Vec<&str> = line.split(',').map(unquote).collect();
    let f0 = fields.first().copied().unwrap_or("").trim().to_lowercase();
    let f1 = fields.get(1).copied().unwrap_or("").trim().to_lowercase();

    // The app sample header: `input` or `input,label`.
    if f0 == "input" {
        return HeaderKind::Plain;
    }
    // The project dataset header: `id,input_type,content,...`.
    if f1 == "input_type" || f1 == "type" {
        return HeaderKind::Typed;
    }
    HeaderKind::Data(sniff_dialect(line))
}

/// No header to read: guess the dialect from the first data line.
fn sniff_dialect(line: &str) -> Dialect {
    let fields: Vec<&str> = line.split(',').collect();
    let f1 = fields.get(1).map(|f| f.trim().to_uppercase());
    match f1.as_deref() {
        Some("URL") | Some("MESSAGE") => Dialect::Typed,
        _ => Dialect::Plain,
    }
}

/// Shared row loop for both entry points.
fn parse_rows(label: &str, text: &str) -> Result<Vec<CsvRowItem>, ThreatError> {
    // Strip a leading BOM before splitting lines.
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut items: Vec<CsvRowItem> = Vec::new();
    let mut dialect: Option<Dialect> = None;
    let mut row_num = 0usize;

    for line in text.lines() {
        row_num += 1;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let d = match dialect {
            Some(d) => d,
            None => match classify_header(trimmed) {
                HeaderKind::Typed => {
                    dialect = Some(Dialect::Typed);
                    continue; // header row consumed
                }
                HeaderKind::Plain => {
                    dialect = Some(Dialect::Plain);
                    continue; // header row consumed
                }
                HeaderKind::Data(d) => {
                    dialect = Some(d);
                    d
                }
            },
        };

        // Over-limit input is a typed file error, never a silently
        // truncated batch (AGENTS.md rule 5).
        if items.len() >= MAX_CSV_ROWS {
            return Err(ThreatError::CsvFileError(format!(
                "CSV file '{}' has more than the maximum of {} data rows",
                label, MAX_CSV_ROWS
            )));
        }

        match d {
            Dialect::Typed => {
                if let Some(item) = parse_typed_row(trimmed, row_num) {
                    items.push(item);
                }
            }
            Dialect::Plain => {
                if let Some(item) = parse_plain_row(trimmed, row_num) {
                    items.push(item);
                }
            }
        }
    }

    if items.is_empty() {
        return Err(ThreatError::CsvFileError(format!(
            "CSV file '{}' contains no readable rows",
            label
        )));
    }
    Ok(items)
}

/// Typed dialect: `id,input_type,content,...`. A row the CSV reader cannot
/// parse, or one with an unknown type column, becomes a typed NotVerified
/// item instead of aborting the whole file.
fn parse_typed_row(line: &str, row_num: usize) -> Option<CsvRowItem> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(line.as_bytes());

    let record = match rdr.records().next() {
        Some(Ok(rec)) => rec,
        _ => {
            return Some(CsvRowItem {
                id: format!("row-{}", row_num),
                input_type: InputType::Message,
                content: String::new(),
                row_index: row_num,
                parse_error: Some(NotVerifiedReason::InvalidCsvRow {
                    row: row_num,
                    details: "Malformed CSV line".to_string(),
                }),
            });
        }
    };

    if record.is_empty() {
        return None;
    }

    let id = record.get(0).unwrap_or("").trim().to_string();
    let raw_type = record.get(1).unwrap_or("").trim().to_uppercase();
    let content = record.get(2).unwrap_or("").trim().to_string();
    let row_id = if id.is_empty() {
        format!("row-{}", row_num)
    } else {
        id
    };

    let input_type = match raw_type.as_str() {
        "URL" => InputType::Url,
        "MESSAGE" => InputType::Message,
        other => {
            return Some(CsvRowItem {
                id: row_id,
                input_type: InputType::Message,
                content,
                row_index: row_num,
                parse_error: Some(NotVerifiedReason::InvalidCsvRow {
                    row: row_num,
                    details: format!("Unknown input type '{}'", other),
                }),
            });
        }
    };

    Some(CsvRowItem {
        id: row_id,
        input_type,
        content,
        row_index: row_num,
        parse_error: None,
    })
}

/// Plain dialect: the first column is the input itself (the app sample
/// format). The type is auto-detected per row (decision D2); blank first
/// fields are skipped like the legacy JS parser does.
fn parse_plain_row(line: &str, row_num: usize) -> Option<CsvRowItem> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(line.as_bytes());

    let record = match rdr.records().next() {
        Some(Ok(rec)) => rec,
        _ => {
            return Some(CsvRowItem {
                id: format!("row-{}", row_num),
                input_type: InputType::Message,
                content: String::new(),
                row_index: row_num,
                parse_error: Some(NotVerifiedReason::InvalidCsvRow {
                    row: row_num,
                    details: "Malformed CSV line".to_string(),
                }),
            });
        }
    };

    let content = record.get(0).unwrap_or("").trim().to_string();
    if content.is_empty() {
        return None;
    }
    Some(CsvRowItem {
        id: format!("row-{}", row_num),
        input_type: detect_input_type(&content),
        content,
        row_index: row_num,
        parse_error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item_briefs(items: &[CsvRowItem]) -> Vec<(String, String, bool)> {
        items
            .iter()
            .map(|i| {
                (
                    i.content.clone(),
                    i.input_type.to_string(),
                    i.parse_error.is_none(),
                )
            })
            .collect()
    }

    #[test]
    fn plain_dialect_reads_the_app_sample_format() {
        let text = "input,label\r\n\
                    https://payments-secure.example/verify-account,High risk\r\n\
                    https://developer.mozilla.org,Low risk\r\n";
        let items = parse_csv_text("sample.csv", text).expect("must parse");
        assert_eq!(items.len(), 2);
        assert_eq!(
            items[0].content,
            "https://payments-secure.example/verify-account"
        );
        assert_eq!(items[0].input_type, InputType::Url);
        assert!(items[0].parse_error.is_none());
        assert_eq!(items[1].input_type, InputType::Url);
    }

    #[test]
    fn plain_dialect_auto_detects_messages() {
        let text = "Your lab appointment is confirmed for tomorrow.\nAccount locked! Verify now.";
        let items = parse_csv_text("msgs.csv", text).expect("must parse");
        assert_eq!(items.len(), 2);
        let briefs = item_briefs(&items);
        assert!(briefs.iter().all(|(_, t, ok)| t == "message" && *ok));
    }

    #[test]
    fn typed_dialect_reads_the_dataset_format() {
        let text = "id,input_type,content,extra\n\
                    1,URL,https://example.edu/x,\n\
                    2,MESSAGE,hello world,\n\
                    3,SMS,bad type,";
        let items = parse_csv_text("data.csv", text).expect("must parse");
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].id, "1");
        assert_eq!(items[0].input_type, InputType::Url);
        assert_eq!(items[1].content, "hello world");
        // Row 3: unknown type column -> typed NotVerified row, not a file error.
        assert!(items[2].parse_error.is_some());
    }

    #[test]
    fn headerless_typed_file_keeps_its_first_row() {
        // Regression: the old parser discarded line 1 unconditionally.
        let text = "1,URL,https://a.example\n2,MESSAGE,plain text here";
        let items = parse_csv_text("nohdr.csv", text).expect("must parse");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "1");
        assert_eq!(items[0].content, "https://a.example");
        assert_eq!(items[1].content, "plain text here");
    }

    #[test]
    fn headerless_plain_file_is_sniffed() {
        let text = "https://a.example\nplain message without columns";
        let items = parse_csv_text("nohdr.csv", text).expect("must parse");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].input_type, InputType::Url);
        assert_eq!(items[1].input_type, InputType::Message);
    }

    #[test]
    fn row_limit_is_a_typed_error_not_truncation() {
        let mut text = String::new();
        for i in 0..(MAX_CSV_ROWS + 1) {
            text.push_str(&format!("https://example.com/page/{}\n", i));
        }
        let err = parse_csv_text("big.csv", &text).expect_err("over-limit must fail");
        assert!(
            err.to_string().contains(&MAX_CSV_ROWS.to_string()),
            "error should mention the limit, got: {}",
            err
        );
    }

    #[test]
    fn header_only_and_empty_files_are_typed_errors() {
        let err =
            parse_csv_text("h.csv", "id,input_type,content").expect_err("header-only must fail");
        assert!(err.to_string().contains("no readable rows"));
        let err = parse_csv_text("e.csv", "").expect_err("empty must fail");
        assert!(err.to_string().contains("is empty"));
    }

    #[test]
    fn blank_lines_and_bom_are_tolerated() {
        let text = "\u{feff}\n\nid,input_type,content\n\n1,URL,https://a.example\n\n";
        let items = parse_csv_text("bom.csv", text).expect("must parse");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].content, "https://a.example");
    }
}
