//! Flexible CSV parser for batch analysis.
//!
//! Handles quirks:
//! - Flexible width (extra trailing columns)
//! - BOM stripping
//! - Mixed CRLF/LF line endings
//! - Tolerates row errors without aborting file

use crate::error::ThreatError;
use crate::models::{InputType, NotVerifiedReason};
use std::fs::File;
use std::io::{BufRead, BufReader};
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

    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();

    // Read header line
    let header_line = match lines.next() {
        Some(Ok(line)) => line,
        Some(Err(e)) => return Err(ThreatError::Io(e)),
        None => {
            return Err(ThreatError::CsvFileError(
                "CSV file has no lines".to_string(),
            ))
        }
    };

    let _clean_header = header_line.trim_start_matches('\u{feff}');
    let mut items = Vec::new();
    let mut row_num = 1;

    for line_result in lines {
        row_num += 1;
        let line = match line_result {
            Ok(l) => l,
            Err(e) => {
                items.push(CsvRowItem {
                    id: format!("row-{}", row_num),
                    input_type: InputType::Message,
                    content: String::new(),
                    row_index: row_num,
                    parse_error: Some(NotVerifiedReason::InvalidCsvRow {
                        row: row_num,
                        details: e.to_string(),
                    }),
                });
                continue;
            }
        };

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Parse with flexible CSV reader
        let mut rdr = csv::ReaderBuilder::new()
            .has_headers(false)
            .flexible(true)
            .from_reader(trimmed.as_bytes());

        let record = match rdr.records().next() {
            Some(Ok(rec)) => rec,
            _ => {
                items.push(CsvRowItem {
                    id: format!("row-{}", row_num),
                    input_type: InputType::Message,
                    content: String::new(),
                    row_index: row_num,
                    parse_error: Some(NotVerifiedReason::InvalidCsvRow {
                        row: row_num,
                        details: "Malformed CSV line".to_string(),
                    }),
                });
                continue;
            }
        };

        if record.is_empty() {
            continue;
        }

        let id = record.get(0).unwrap_or("").trim().to_string();
        let raw_type = record.get(1).unwrap_or("").trim().to_uppercase();
        let content = record.get(2).unwrap_or("").trim().to_string();

        let input_type = match raw_type.as_str() {
            "URL" => InputType::Url,
            "MESSAGE" => InputType::Message,
            other => {
                items.push(CsvRowItem {
                    id: if id.is_empty() {
                        format!("row-{}", row_num)
                    } else {
                        id
                    },
                    input_type: InputType::Message,
                    content,
                    row_index: row_num,
                    parse_error: Some(NotVerifiedReason::InvalidCsvRow {
                        row: row_num,
                        details: format!("Unknown input type '{}'", other),
                    }),
                });
                continue;
            }
        };

        items.push(CsvRowItem {
            id: if id.is_empty() {
                format!("row-{}", row_num)
            } else {
                id
            },
            input_type,
            content,
            row_index: row_num,
            parse_error: None,
        });

        if items.len() >= MAX_CSV_ROWS {
            break;
        }
    }

    Ok(items)
}
