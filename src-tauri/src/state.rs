//! Shell state: registry of in-flight batch cancellation tokens.
//!
//! A plain `std::sync::Mutex` is enough here — critical sections only touch
//! a small map, and the batches themselves run on the async runtime, never
//! holding this lock across an `.await`.

use std::collections::HashMap;
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct BatchRegistry {
    tokens: Mutex<HashMap<String, CancellationToken>>,
}

impl BatchRegistry {
    pub fn insert(&self, batch_id: String, token: CancellationToken) {
        if let Ok(mut map) = self.tokens.lock() {
            map.insert(batch_id, token);
        }
    }

    /// Signals cooperative cancellation. Returns `false` when the batch is
    /// unknown (already finished, or never started).
    pub fn cancel(&self, batch_id: &str) -> bool {
        match self.tokens.lock() {
            Ok(map) => map.get(batch_id).map(|t| t.cancel()).is_some(),
            Err(_) => false, // poisoned lock: nothing sensible to report
        }
    }

    pub fn remove(&self, batch_id: &str) {
        if let Ok(mut map) = self.tokens.lock() {
            map.remove(batch_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_semantics() {
        let registry = BatchRegistry::default();
        let token = CancellationToken::new();

        assert!(
            !registry.cancel("unknown"),
            "unknown batch must report false"
        );

        registry.insert("batch-1".to_string(), token.clone());
        assert!(!token.is_cancelled(), "insert must not cancel");
        assert!(registry.cancel("batch-1"), "known batch must report true");
        assert!(token.is_cancelled(), "cancel must reach the token");
        assert!(registry.cancel("batch-1"), "repeat cancel stays true");

        registry.remove("batch-1");
        assert!(
            !registry.cancel("batch-1"),
            "removed batch must report false"
        );
    }
}
