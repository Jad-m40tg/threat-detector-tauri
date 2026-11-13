use std::path::PathBuf;
use threat_core::csv_parser::parse_csv_file;
use threat_core::engine::analyze_item;
use threat_core::models::{AnalysisRequest, RiskLevel, Verdict};

#[test]
fn test_ten_row_dataset_acceptance() {
    let mut fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    fixture_path.push("tests");
    fixture_path.push("fixtures");
    fixture_path.push("project_test_dataset.csv");

    assert!(
        fixture_path.exists(),
        "Test dataset fixture must exist at {:?}",
        fixture_path
    );

    let items = parse_csv_file(&fixture_path).expect("CSV parser must parse dataset file");
    assert_eq!(items.len(), 10, "Expected exactly 10 rows in test dataset");

    for item in &items {
        let result = if let Some(err) = &item.parse_error {
            threat_core::models::ItemResult {
                id: item.id.clone(),
                input_type: item.input_type,
                content: item.content.clone(),
                verdict: Verdict::NotVerified {
                    reason: err.clone(),
                },
                duration_ms: 0,
            }
        } else {
            analyze_item(&AnalysisRequest {
                id: Some(item.id.clone()),
                input_type: Some(item.input_type),
                content: item.content.clone(),
            })
        };

        match item.id.as_str() {
            "1" => match result.verdict {
                Verdict::Assessed { level, .. } => {
                    assert_eq!(level, RiskLevel::Low, "Row 1 should be Low")
                }
                Verdict::NotVerified { .. } => panic!("Row 1 should be Assessed as Low"),
            },
            "2" => match result.verdict {
                Verdict::Assessed { level, .. } => {
                    assert_eq!(level, RiskLevel::High, "Row 2 should be High")
                }
                Verdict::NotVerified { .. } => panic!("Row 2 should be Assessed as High"),
            },
            "3" => match result.verdict {
                Verdict::Assessed { level, .. } => {
                    assert_eq!(level, RiskLevel::High, "Row 3 should be High")
                }
                Verdict::NotVerified { .. } => panic!("Row 3 should be Assessed as High"),
            },
            "4" => match result.verdict {
                Verdict::Assessed { level, .. } => {
                    assert_eq!(level, RiskLevel::High, "Row 4 should be High")
                }
                Verdict::NotVerified { .. } => panic!("Row 4 should be Assessed as High"),
            },
            "5" => match result.verdict {
                Verdict::Assessed { level, .. } => {
                    assert_eq!(level, RiskLevel::Medium, "Row 5 should be Medium")
                }
                Verdict::NotVerified { .. } => panic!("Row 5 should be Assessed as Medium"),
            },
            "6" => match result.verdict {
                Verdict::Assessed { level, .. } => {
                    assert_eq!(level, RiskLevel::Low, "Row 6 should be Low")
                }
                Verdict::NotVerified { .. } => panic!("Row 6 should be Assessed as Low"),
            },
            "7" => match result.verdict {
                Verdict::Assessed { level, .. } => {
                    assert_eq!(level, RiskLevel::High, "Row 7 should be High")
                }
                Verdict::NotVerified { .. } => panic!("Row 7 should be Assessed as High"),
            },
            "8" => match result.verdict {
                Verdict::Assessed { level, .. } => {
                    assert_eq!(level, RiskLevel::Medium, "Row 8 should be Medium")
                }
                Verdict::NotVerified { .. } => panic!("Row 8 should be Assessed as Medium"),
            },
            "9" => {
                match result.verdict {
                    Verdict::NotVerified { .. } => {} // Expected!
                    Verdict::Assessed { level, .. } => {
                        panic!("Row 9 must be NotVerified, but got {:?}", level)
                    }
                }
            }
            "10" => {
                match result.verdict {
                    Verdict::NotVerified { .. } => {} // Expected!
                    Verdict::Assessed { level, .. } => {
                        panic!("Row 10 must be NotVerified, but got {:?}", level)
                    }
                }
            }
            other => panic!("Unexpected item ID: {}", other),
        }
    }
}
