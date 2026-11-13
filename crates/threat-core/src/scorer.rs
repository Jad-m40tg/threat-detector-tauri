//! Scorer module: maps accumulated rule hits to RiskLevel and Verdict.

use crate::models::{RiskLevel, RuleHit, Verdict};

/// Scores rule hits and produces an `Assessed` Verdict.
///
/// Thresholds:
/// - 0 - 1 points: Low
/// - 2 - 4 points: Medium
/// - 5+ points: High
pub fn score_hits(hits: Vec<RuleHit>) -> Verdict {
    let raw_score: u32 = hits.iter().map(|h| h.points).sum();

    // Normalized display score (0 - 99 range for UI gauges)
    let display_score = if raw_score == 0 {
        12 // Clean baseline
    } else {
        (raw_score * 15).min(99)
    };

    let level = if raw_score <= 1 {
        RiskLevel::Low
    } else if raw_score <= 4 {
        RiskLevel::Medium
    } else {
        RiskLevel::High
    };

    Verdict::Assessed {
        level,
        score: display_score,
        hits,
    }
}
