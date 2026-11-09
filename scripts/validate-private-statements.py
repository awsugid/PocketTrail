#!/usr/bin/env python3
"""Validate real local Jago samples without printing private statement contents."""

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import subprocess
import tempfile


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--text-directory", type=Path,
                        help="Use statement-N.txt browser outputs instead of pdftotext.")
    parser.add_argument("--compare-native", action="store_true",
                        help="Compare browser records with independent pdftotext records.")
    args = parser.parse_args()
    project = Path(__file__).resolve().parent.parent
    files = sorted(
        p for p in args.directory.glob("Jago*.pdf")
        if p.name.startswith(("Jago_AWS UG Jakarta_", "Jago_AWS User Group Indonesia_"))
    )
    if not files:
        print("No community statement samples found. No personal-pocket files inspected.")
        return 1
    failed = False
    cumulative: dict[tuple[str, str], tuple] = {}
    overlaps = 0
    conflicts = 0
    with tempfile.TemporaryDirectory(prefix="pockettrail-validation-") as temporary:
        for index, pdf in enumerate(files, 1):
            extracted = Path(temporary) / "statement.txt"
            if args.text_directory:
                browser_text = args.text_directory / f"statement-{index}.txt"
                if not browser_text.is_file():
                    print(f"Sample {index}: browser text missing.")
                    failed = True
                    continue
                extracted.write_text(browser_text.read_text())
            else:
                extraction = subprocess.run(
                    ["pdftotext", "-layout", str(pdf), str(extracted)],
                    capture_output=True, text=True,
                )
                if extraction.returncode:
                    print(f"Sample {index}: extraction failed (private error output withheld).")
                    failed = True
                    continue
            text = extracted.read_text()
            expected_ids = re.findall(r"\bID\s*#\s*(\S+)", text)
            output = Path(temporary) / "parsed.json"
            result = subprocess.run(
                ["cargo", "run", "--quiet", "--manifest-path",
                 str(project / "crates/jago-parser/Cargo.toml"),
                 "--example", "parse", "--", str(extracted), str(output)],
                cwd=project, capture_output=True, text=True,
            )
            if result.returncode:
                print(f"Sample {index}: parser failed (private error output withheld).")
                failed = True
                continue
            try:
                parsed = json.loads(output.read_text())
                rows = parsed["transactions"]
                actual_ids = [row["bank_id"] for row in rows]
                ids_match = Counter(actual_ids) == Counter(expected_ids)
                running_errors = sum(
                    previous["balance_minor"] + current["amount_minor"] != current["balance_minor"]
                    for previous, current in zip(rows, rows[1:])
                )
                unique = len(actual_ids) == len(set(actual_ids))
                dates_valid = all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", r["date"]) for r in rows)
                money_valid = all(
                    isinstance(r[key], int) and not isinstance(r[key], bool)
                    for r in rows for key in ("amount_minor", "balance_minor")
                )
                pocket = "jakarta" if pdf.name.startswith("Jago_AWS UG Jakarta_") else "indonesia"
                for row in rows:
                    key = (pocket, row["bank_id"])
                    facts = tuple(row[k] for k in (
                        "date", "time", "amount_minor", "balance_minor", "counterparty",
                    ))
                    if key in cumulative:
                        overlaps += 1
                        if cumulative[key] != facts:
                            conflicts += 1
                    else:
                        cumulative[key] = facts
                ok = ids_match and unique and dates_valid and money_valid and running_errors == 0
                if args.compare_native and args.text_directory:
                    native_text = Path(temporary) / "native.txt"
                    native_output = Path(temporary) / "native.json"
                    subprocess.run(
                        ["pdftotext", "-layout", str(pdf), str(native_text)],
                        capture_output=True, check=True,
                    )
                    subprocess.run(
                        ["cargo", "run", "--quiet", "--manifest-path",
                         str(project / "crates/jago-parser/Cargo.toml"),
                         "--example", "parse", "--", str(native_text), str(native_output)],
                        cwd=project, capture_output=True, check=True,
                    )
                    native = {
                        row["bank_id"]: row
                        for row in json.loads(native_output.read_text())["transactions"]
                    }
                    browser = {row["bank_id"]: row for row in rows}
                    mismatches = {
                        field: sum(native[key][field] != browser[key][field]
                                   for key in native.keys() & browser.keys())
                        for field in ("date", "time", "counterparty", "transaction_type",
                                      "notes", "amount_minor", "balance_minor")
                    }
                    ok &= native.keys() == browser.keys() and not any(mismatches.values())
                    print(f"Sample {index}: browser/native field mismatch counts={mismatches}")
                print(
                    f"Sample {index}: rows={len(rows)}, references_exact={ids_match}, "
                    f"unique={unique}, running_balance_errors={running_errors}, "
                    f"warnings={len(parsed.get('warnings', []))}, result={'PASS' if ok else 'FAIL'}"
                )
                failed |= not ok
            except (ValueError, KeyError, TypeError, subprocess.CalledProcessError):
                print(f"Sample {index}: invalid parser result (private output withheld).")
                failed = True
    print(
        f"Cumulative checks: samples={len(files)}, unique_pocket_transactions={len(cumulative)}, "
        f"overlapping_rows={overlaps}, conflicting_bank_snapshots={conflicts}."
    )
    print("No raw statement contents, identifiers, names, or balances printed.")
    return 1 if failed or conflicts else 0


if __name__ == "__main__":
    raise SystemExit(main())
