# Vendored assets (pinned local copies)

- `htmx.min.js` — htmx.org 1.9.12, BSD 2-Clause. https://unpkg.com/htmx.org@1.9.12/dist/htmx.min.js
- `pdf.min.mjs`, `pdf.worker.min.mjs` — pdfjs-dist **4.10.38** ESM build,
  Apache License 2.0. https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/
  - Patched release: 3.11.174 was vulnerable to CVE-2024-4367 (arbitrary JS
    execution via malicious font); fixed >= 4.2.67. The app additionally
    passes `isEvalSupported: false` on every `getDocument` call.
  - Loaded via dynamic `import()`; text extraction runs entirely in the
    browser — statements are never sent to a third party.