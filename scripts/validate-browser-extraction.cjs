#!/usr/bin/env node
/* Exercise the shipped PDF.js browser path. Never log extracted financial data. */
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");

async function main() {
  const root = path.resolve(__dirname, "..");
  const sampleDir = process.argv[2] || root;
  const outputDir = process.env.POCKETTRAIL_EXTRACT_DIR
    || path.join(root, "local-data", "browser-statements");
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const names = (await fs.readdir(sampleDir)).filter(
    (name) => /^Jago_AWS (UG Jakarta|User Group Indonesia)_.*\.pdf$/.test(name),
  ).sort();
  if (!names.length) throw new Error("No community statement samples found.");
  const server = http.createServer(async (req, res) => {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><title>Local extraction test</title><script src="/extraction.cjs"></script>');
      return;
    }
    const allowed = new Map([
      ["/extraction.cjs", "extraction.cjs"],
      ["/vendor/pdf.min.mjs", "vendor/pdf.min.mjs"],
      ["/vendor/pdf.worker.min.mjs", "vendor/pdf.worker.min.mjs"],
    ]);
    const relative = allowed.get(req.url);
    if (!relative) { res.writeHead(404); res.end(); return; }
    try {
      res.setHeader("Content-Type", "text/javascript");
      res.end(await fs.readFile(path.join(root, "migration", "static", relative)));
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.POCKETTRAIL_CHROMIUM || undefined,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    for (let i = 0; i < names.length; i++) {
      const base64 = (await fs.readFile(path.join(sampleDir, names[i]))).toString("base64");
      const result = await page.evaluate(async (encoded) => {
        const lib = await import("/vendor/pdf.min.mjs");
        lib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
        const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
        const pdf = await lib.getDocument({ data: bytes, isEvalSupported: false }).promise;
        const pages = [];
        const noteBaselineOffsets = {};
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const content = await page.getTextContent();
          const dates = content.items.filter((it) => /^\d{1,2} [A-Za-z]{3} \d{4}$/.test(it.str));
          const notesHeader = content.items.find((it) => it.str === "Notes");
          const amountHeader = content.items.find((it) => it.str === "Amount");
          if (dates.length && notesHeader && amountHeader) {
            for (const item of content.items) {
              if (!item.str.trim() || item === notesHeader
                  || item.transform[4] < notesHeader.transform[4] - 1
                  || item.transform[4] >= amountHeader.transform[4] - 5) continue;
              const offsets = dates.map((date) => item.transform[5] - date.transform[5]);
              offsets.sort((a, b) => Math.abs(a) - Math.abs(b));
              if (Math.abs(offsets[0]) < 8) {
                const bucket = offsets[0].toFixed(1);
                noteBaselineOffsets[bucket] = (noteBaselineOffsets[bucket] || 0) + 1;
              }
            }
          }
          pages.push(window.PocketTrailExtraction.itemsToText(content.items));
        }
        const text = pages.join("\n");
        const references = [...text.matchAll(/\bID\s*#\s*(\S+)/g)].map((m) => m[1]);
        await pdf.destroy();
        return { text, pages: pages.length, references: references.length,
          uniqueReferences: new Set(references).size, noteBaselineOffsets };
      }, base64);
      await fs.writeFile(path.join(outputDir, `statement-${i + 1}.txt`), result.text, { mode: 0o600 });
      console.log(`Sample ${i + 1}: pages=${result.pages}, references=${result.references}, unique=${result.uniqueReferences}`);
      if (process.env.POCKETTRAIL_LAYOUT_DIAGNOSTICS === "1") {
        console.log("Note-to-date baseline offsets (points, counts only):", result.noteBaselineOffsets);
      }
    }
    console.log(`Browser extraction completed for ${names.length} community PDFs; text retained in ignored local data only.`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch(() => {
  console.error("Browser extraction validation failed; raw errors withheld to protect sample data.");
  process.exitCode = 1;
});
