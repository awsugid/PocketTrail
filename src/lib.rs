pub mod auth;
pub mod domain_map;
pub mod fmt;
pub mod mentions;
pub mod notify_rules;

#[path = "web/render.rs"]
pub mod render;

#[cfg(target_arch = "wasm32")]
pub mod web;
