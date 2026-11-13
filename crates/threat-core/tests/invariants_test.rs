use threat_core::engine::analyze_item;
use threat_core::models::{AnalysisRequest, InputType, Verdict};

#[test]
fn test_not_verified_invariants_sweep() {
    let test_cases = vec![
        ("", "Empty string"),
        ("   ", "Whitespace only"),
        ("\t\r\n", "Newlines and tabs"),
        ("ht!tp://invalid-url-with-bang.com", "Malformed scheme"),
        ("https://", "Missing host"),
        ("http://", "Missing host 2"),
    ];

    for (input, label) in test_cases {
        let res = analyze_item(&AnalysisRequest {
            id: None,
            input_type: None,
            content: input.to_string(),
        });

        match res.verdict {
            Verdict::NotVerified { .. } => {
                // Must convert to IPC shape without claiming Low or SAFE
                let ipc = res.to_ipc_shape(1000);
                assert_eq!(
                    ipc.risk_level, "NotVerified",
                    "{}: risk_level must be NotVerified",
                    label
                );
                assert_eq!(ipc.risk, "unverified", "{}: risk must be unverified", label);
                assert_eq!(
                    ipc.state, "NOT_VERIFIED",
                    "{}: state must be NOT_VERIFIED",
                    label
                );
                assert!(
                    ipc.score.is_none(),
                    "{}: score must be None for NotVerified",
                    label
                );
                assert_ne!(
                    ipc.risk_level, "Low",
                    "{}: Invariant violated! Claimed Low",
                    label
                );
                assert_ne!(
                    ipc.state, "SAFE",
                    "{}: Invariant violated! Claimed SAFE",
                    label
                );
            }
            Verdict::Assessed { level, .. } => {
                panic!(
                    "Invariant violated! Input '{}' ({}) was assessed as {:?}",
                    input, label, level
                );
            }
        }
    }
}

#[test]
fn test_oversized_input_invariant() {
    let huge_url = format!("https://example.com/{}", "a".repeat(3000));
    let res = analyze_item(&AnalysisRequest {
        id: None,
        input_type: Some(InputType::Url),
        content: huge_url,
    });

    match res.verdict {
        Verdict::NotVerified { .. } => {
            let ipc = res.to_ipc_shape(1000);
            assert_eq!(ipc.risk_level, "NotVerified");
            assert_eq!(ipc.state, "NOT_VERIFIED");
        }
        Verdict::Assessed { .. } => panic!("Oversized URL must be NotVerified"),
    }
}
