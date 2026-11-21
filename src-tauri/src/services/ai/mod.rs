//! AI overview backend: provider settings, failover and typed errors.
//! All HTTP happens in Rust; the front-end never sees an API key.

pub mod commands;
pub mod config;
pub mod parser;
pub mod prompt;
pub mod providers;
pub mod service;
pub mod transport;
pub mod types;

pub use service::AiService;
