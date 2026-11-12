"use strict";
/* Standalone test for the fixed-grid text reconstruction.
   Run: node static/extraction.test.js
   All fixture content is synthetic; no real statement values appear here. */
var assert = require("assert");
var ex = require("./extraction.js");

function item(str, x, y, w) {
  var it = { str: str, transform: [1, 0, 0, 1, x, y] };
  if (w !== undefined) it.width = w;
  return it;
}

var BODY = 4.8;   // body font: px per char
var HEAD = 6.0;   // wider header font: px per char

function chars(n, px) { return n * px; }

// Synthetic statement: header row (wide font), data row with amount+balance
// columns, an indented continuation row, and a synthetic whitespace item
// sitting in the amount/balance gap (pdf.js emits these; they must be ignored).
var items = [
  // Header (y=750), same x anchors as the body row below
  item("Date", 40, 750, chars(4, HEAD)),
  item("Details", 200, 750, chars(7, HEAD)),
  item("Amount", 520, 750, chars(6, HEAD)),
  item("Balance", 610, 750, chars(7, HEAD)),
  // Data row (y=700)
  item("01/03/2025", 40, 700, chars(10, BODY)),
  item("TF-77 TRANSFER to Store X", 200, 700, chars(25, BODY)),
  item("1.500.000,00", 520, 700, chars(12, BODY)),
  item(" ", 580, 700, 5),                 // synthetic whitespace: must vanish
  item("1.700.000,00", 610, 700, chars(12, BODY)),
  // Continuation row (y=672): starts at the Details column, not page-left
  item("catatan lanjutan tanpa tanggal", 200, 672, chars(28, BODY))
];

var text = ex.itemsToText(items);
var rows = text.split("\n");

assert.strictEqual(rows.length, 3, "three rows, got " + rows.length);

// 1) Same-x header/body cells must land on the same absolute column.
function startsOf(row, needles) {
  return needles.map(function (n) { return row.indexOf(n); });
}
var headerStarts = startsOf(rows[0], ["Details", "Amount", "Balance"]);
var bodyStarts = startsOf(rows[1], ["TF-77", "1.500.000,00", "1.700.000,00"]);
assert.deepStrictEqual(
  headerStarts, bodyStarts,
  "header and body columns align on the absolute grid: " + JSON.stringify([rows[0], rows[1]])
);

// 2) Amount and balance stay separate columns despite the whitespace item.
assert.strictEqual(rows[1].split(/\s{2,}/).length, 4, "row splits into 4 columns: " + JSON.stringify(rows[1]));
assert.ok(/\s{2,}/.test(rows[1]), "amount/balance gap >= 2 spaces");

// 3) Continuation indent is preserved (line starts at the Details column).
var indent = rows[2].match(/^ */)[0].length;
assert.ok(indent > 10, "continuation line keeps leading indentation, got " + indent);
assert.strictEqual(rows[2].indexOf("catatan"), indent, "indent lands on the grid column");

// Robustness
assert.strictEqual(ex.itemsToText([]), "", "empty items -> empty text");
assert.strictEqual(ex.itemsToText([item("   ", 100, 100, 3)]), "", "whitespace-only items are dropped");
var mixed = ex.itemsToText([
  item("A", 40, 900, chars(1, HEAD)),
  item("b", 52, 900, chars(1, BODY))
]);
assert.ok(!/NaN|undefined/.test(mixed), "no NaN/undefined leakage");

// Italic notes can sit three PDF points above their transaction baseline.
// They must not become a separate line preceding (and attached to) another row.
var italicRows = ex.itemsToText([
  item("01 Mar 2025", 40, 700, chars(11, BODY)),
  item("Event food", 350, 703, chars(10, BODY)),
  item("-150.000", 520, 700, chars(8, BODY)),
  item("12:00", 40, 688, chars(5, BODY)),
  item("ID# TEST-77", 200, 688, chars(11, BODY))
]).split("\n");
assert.strictEqual(italicRows.length, 2, "italic note shares transaction line");
assert.ok(italicRows[0].includes("Event food") && italicRows[0].includes("01 Mar 2025"));
assert.ok(italicRows[1].includes("ID# TEST-77"), "time/ID line stays separate");

console.log("extraction.test.js: all assertions passed (fixed absolute-x grid)");

