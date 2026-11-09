// Embeds every templates/*.html file into the binary (Workers wasm has no
// filesystem at runtime). Template names are the relative path with the
// `.html` suffix stripped, e.g. templates/transaction.html -> "transaction".
// Also register the filename used by template inheritance.
use std::path::Path;

fn main() {
    println!("cargo:rerun-if-changed=templates");
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let root = Path::new(&manifest).join("templates");
    let mut found = Vec::new();
    collect(&root, &root, &mut found);
    found.sort();
    let mut out = String::from("pub(crate) static TEMPLATES: &[(&str, &str)] = &[");
    for (name, body) in &found {
        out.push_str(&format!("\n    ({name:?}, {body:?}),"));
        let filename = format!("{name}.html");
        out.push_str(&format!("\n    ({filename:?}, {body:?}),"));
    }
    out.push_str("\n];\n");
    let out_dir = std::env::var("OUT_DIR").unwrap();
    std::fs::write(Path::new(&out_dir).join("templates.rs"), out).expect("write templates.rs");
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<(String, String)>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect(root, &p, out);
        } else if p.extension().is_some_and(|x| x == "html") {
            let rel = p
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            let name = rel.trim_end_matches(".html").to_string();
            match std::fs::read_to_string(&p) {
                Ok(body) => out.push((name, body)),
                Err(e) => panic!("read template {}: {e}", p.display()),
            }
        }
    }
}
