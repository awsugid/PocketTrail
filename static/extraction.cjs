/* PocketTrail statement-text extraction helpers.

   Converts pdf.js text items to layout-faithful text on a FIXED absolute-x
   grid so statement parsers can rely on column positions across fonts:

   - Whitespace-only items (pdf.js synthetic ' ' runs) are ignored entirely.
   - One page-wide charWidth is derived robustly as a low percentile of
     per-character widths, so header and body fonts share one grid.
   - Every item maps to a column: round((x - pageMinX) / charWidth). The grid
     is absolute, so same-x header/body cells land on the same column.
   - Lines are rows grouped by transform-y (3.5-unit tolerance), sorted by x.
   - Leading indentation is preserved: the line starts at its first item's
     column.
   - Gaps advance on the grid: gap >= 2 columns emits that many spaces (>= 2,
     which is what column parsers split on); a sub-column physical gap emits
     one space; touching fragments emit none.

   Shared by the browser (window.PocketTrailExtraction) and the node test
   (static/extraction.test.js). */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PocketTrailExtraction = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Jago italic notes sit 3 PDF points above their date/amount baseline.
  // Keep them in the same row, without merging the separate time/ID line.
  var LINE_TOLERANCE = 3.5;
  var FALLBACK_CHAR_WIDTH = 4;
  var CHAR_WIDTH_PERCENTILE = 0.1;

  function itemsToText(items) {
    var pts = [];
    (items || []).forEach(function (it) {
      if (!it || typeof it.str !== "string" || it.str.trim() === "") return;
      pts.push({
        x: it.transform[4],
        y: it.transform[5],
        w: typeof it.width === "number" && it.width > 0
          ? it.width
          : it.str.length * FALLBACK_CHAR_WIDTH,
        s: it.str
      });
    });
    if (!pts.length) return "";

    var minX = Math.min.apply(null, pts.map(function (p) { return p.x; }));
    var charWidth = deriveCharWidth(pts);

    pts.forEach(function (p) {
      p.col = Math.round((p.x - minX) / charWidth);
      p.endCol = p.col + Math.max(Math.round(p.w / charWidth), 1);
    });

    pts.sort(function (a, b) { return (b.y - a.y) || (a.x - b.x); });

    var lines = [];
    var line = null;
    pts.forEach(function (p) {
      if (!line || Math.abs(p.y - line.y) > LINE_TOLERANCE) {
        line = { y: p.y, items: [p] };
        lines.push(line);
      } else {
        line.items.push(p);
      }
    });

    return lines.map(function (ln) {
      ln.items.sort(function (a, b) { return a.x - b.x; });
      return renderLine(ln.items, charWidth);
    }).join("\n");
  }

  /* Grid columns consumed by an item's glyphs. */
  function advance(p, charWidth) {
    return Math.max(Math.round(p.w / charWidth), 1);
  }

  /* Emit a row on the grid. Each item's text is padded out to its grid
     advance, so the string cursor always equals the grid cursor and items
     with the same x land on the same string column in every row, regardless
     of font. Item-trailing pad merges with the inter-column gap; parsers
     split on runs of 2+ spaces, so no false column boundary is created. */
  function renderLine(items, charWidth) {
    var first = items[0];
    var adv = advance(first, charWidth);
    var text = repeat(first.col) + first.s + repeat(Math.max(adv - first.s.length, 0));
    var cursor = first.col + adv;
    for (var i = 1; i < items.length; i++) {
      var cur = items[i];
      var pad = cur.col - cursor;
      if (pad >= 2) {
        text += repeat(pad);
      } else if (pad >= 1) {
        text += " ";
      } else if (cur.x - (items[i - 1].x + items[i - 1].w) > 0.3 * charWidth) {
        text += " ";
      }
      adv = advance(cur, charWidth);
      text += cur.s + repeat(Math.max(adv - cur.s.length, 0));
      cursor = cur.col + adv;
    }
    return text.replace(/\s+$/, "");
  }

  /* Low percentile of per-character widths: robust against a few wide
     header-font items dominating the estimate. */
  function deriveCharWidth(pts) {
    var per = pts.map(function (p) { return p.w / Math.max(p.s.length, 1); })
      .filter(function (w) { return isFinite(w) && w > 0; })
      .sort(function (a, b) { return a - b; });
    if (!per.length) return FALLBACK_CHAR_WIDTH;
    var idx = Math.min(per.length - 1, Math.floor(per.length * CHAR_WIDTH_PERCENTILE));
    var w = per[idx];
    return w > 0 ? w : FALLBACK_CHAR_WIDTH;
  }

  function repeat(n) { return new Array(n + 1).join(" "); }

  return { itemsToText: itemsToText, deriveCharWidth: deriveCharWidth };
});

