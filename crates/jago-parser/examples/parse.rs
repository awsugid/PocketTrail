//! Usage: `cargo run --example parse -- <statement.txt> [output.json]`
//!
//! Parses `pdftotext -layout` text and writes the parsed JSON to the output
//! path (default: `<input>.parsed.json`). Only counts are printed to stdout;
//! statement contents never reach the console.
use std::{env, fs, path::PathBuf, process::ExitCode};

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: parse <statement.txt> [output.json]");
        return ExitCode::from(2);
    }
    let input = PathBuf::from(&args[1]);
    let text = match fs::read_to_string(&input) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("read {}: {e}", input.display());
            return ExitCode::from(1);
        }
    };
    let parsed = match pockettrail_jago_parser::parse_statement(&text) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("parse: {e}");
            return ExitCode::from(1);
        }
    };
    let json = serde_json::to_string_pretty(&parsed).expect("ParsedStatement serializes");
    let output = args
        .get(2)
        .map(PathBuf::from)
        .unwrap_or_else(|| input.with_extension("parsed.json"));
    if let Err(e) = fs::write(&output, json + "\n") {
        eprintln!("write {}: {e}", output.display());
        return ExitCode::from(1);
    }
    println!(
        "wrote {} ({} transactions, {} warnings)",
        output.display(),
        parsed.transactions.len(),
        parsed.warnings.len()
    );
    ExitCode::SUCCESS
}
