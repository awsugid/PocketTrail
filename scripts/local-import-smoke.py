#!/usr/bin/env python3
"""Verify reviewed, cumulative imports through HTTP using synthetic PDF files."""
import argparse
import importlib.util
from pathlib import Path
import uuid

spec = importlib.util.spec_from_file_location("smoke", Path(__file__).with_name("local-smoke.py"))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


def statement(run, extra=False, conflict=False):
    def line(*cells):
        return "{:<19} {:<34} {:<39} {:<20} {:<20}{}".format(*cells)
    def continuation(time, bank_id):
        return "{:<19} {:<34} {}".format(time, "", "ID# " + bank_id)
    rows = [
        "Pockets Transactions History   Page 1 of 1",
        line("Date & Time", "Source/Destination", "Transaction Details", "Notes", "Amount", "Balance"),
        line("01 Jan 2026", "Main Pocket (demo)", "Incoming Transfer", "Synthetic deposit", "+10.000", "10.000"),
        continuation("10:00", f"SYNTHETIC-{run}-IN"),
        line("02 Jan 2026", "Main Pocket (demo)", "Outgoing Transfer", "Synthetic food",
             "-2.000" if conflict else "-1.000", "8.000" if conflict else "9.000"),
        continuation("11:00", f"SYNTHETIC-{run}-OUT"),
    ]
    if extra:
        rows.extend([
            line("03 Jan 2026", "Main Pocket (demo)", "Outgoing Transfer", "Synthetic cups",
                 "-1.000", "7.000" if conflict else "8.000"),
            continuation("12:00", f"SYNTHETIC-{run}-EXTRA"),
        ])
    return "\n".join(rows) + "\n"


def pdf(text):
    commands = ["BT /F1 10 Tf 25 850 Td 16 TL"]
    for line in text.splitlines():
        escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        commands.append(f"({escaped}) Tj T*")
    stream = ("\n".join(commands) + "\nET").encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1400 900] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    body = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for n, obj in enumerate(objects, 1):
        offsets.append(len(body))
        body.extend(f"{n} 0 obj\n".encode() + obj + b"\nendobj\n")
    start = len(body)
    body.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        body.extend(f"{offset:010} 00000 n \n".encode())
    body.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode())
    return bytes(body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8787")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    assert smoke.urllib.parse.urlsplit(base).hostname in {"localhost", "127.0.0.1", "::1"}
    root = Path(__file__).resolve().parent.parent
    db = smoke.fixture_database(root)
    run = uuid.uuid4().hex[:12]
    org = "/org/demo-jakarta"
    alice, bob = smoke.Client(base), smoke.Client(base)
    alice.login("alice")
    bob.login("bob")
    alice.request(org + "/settings/notifications", [("cutoff_date", "2025-01-01")], expected=(303,))
    bank_id = f"SYNTHETIC-{run}-OUT"

    def stage(text):
        alice.request(org + "/imports")
        headers, _ = alice.request(org + "/imports", [
            ("pocket_id", "1"), ("statement_text", text)
        ], expected=(303,), file=pdf(text))
        location = headers["Location"]
        alice.request(location)
        return location

    initial_count = db.execute("SELECT COUNT(*) FROM transactions WHERE org_id=1").fetchone()[0]
    first = stage(statement(run))
    assert db.execute("SELECT COUNT(*) FROM transactions WHERE org_id=1").fetchone()[0] == initial_count, "Preview created bank records"
    alice.request(first + "/confirm", [], expected=(303,))
    assert db.execute("SELECT COUNT(*) FROM transactions WHERE org_id=1").fetchone()[0] == initial_count + 2
    assert db.execute("SELECT responsible_membership_id FROM transactions WHERE org_id=1 AND pocket_id=1 AND bank_id=?", (f"SYNTHETIC-{run}-IN",)).fetchone() == (None,), "Income used expense actor mapping"
    assert db.execute("SELECT responsible_membership_id FROM transactions WHERE org_id=1 AND pocket_id=1 AND bank_id=?", (bank_id,)).fetchone() == (1,), "Expense lost pocket-scoped mapping"
    txn_id = db.execute("SELECT id FROM transactions WHERE org_id=1 AND pocket_id=1 AND bank_id=?", (bank_id,)).fetchone()[0]
    txn = org + f"/transactions/{txn_id}"
    alice.request(txn)
    alice.request(txn + "/details", [
        ("explanation", "Synthetic purpose preserved across cumulative exports"),
        ("responsible_member_id", "1"),
        ("evidence_unavailable_reason", "Synthetic fixture only"),
        ("split_label[]", "Synthetic event food"), ("split_amount[]", "1000"),
        ("split_member[]", "1")
    ], expected=(303,))
    alice.request(txn + "/comments", [("body", "Synthetic discussion survives import")], expected=(303,))
    bob.request(txn)
    bob.request(txn + "/approve", [], expected=(303,))
    before = db.execute(
        "SELECT explanation,status,responsible_membership_id,revision FROM transactions WHERE id=?", (txn_id,)
    ).fetchone()
    second = stage(statement(run, extra=True))
    alice.request(second + "/confirm", [], expected=(303,))
    assert db.execute("SELECT COUNT(*) FROM transactions WHERE org_id=1").fetchone()[0] == initial_count + 3
    assert db.execute(
        "SELECT explanation,status,responsible_membership_id,revision FROM transactions WHERE id=?", (txn_id,)
    ).fetchone() == before, "Re-import replaced existing documentation or approval"
    alice.request(second + "/confirm", [], expected=(200, 303))
    assert db.execute("SELECT COUNT(*) FROM transactions WHERE org_id=1").fetchone()[0] == initial_count + 3, "Repeated confirmation duplicated rows"
    conflict = stage(statement(run, extra=True, conflict=True))
    alice.request(conflict + "/confirm", [], expected=(200, 303, 400, 409))
    assert db.execute("SELECT amount_minor FROM transactions WHERE id=?", (txn_id,)).fetchone() == (-100000,), "Conflict overwrote bank facts"
    assert db.execute("SELECT status FROM transactions WHERE id=?", (txn_id,)).fetchone() == ("approved",)
    assert db.execute("SELECT COUNT(*) FROM comments WHERE transaction_id=?", (txn_id,)).fetchone()[0] == 1
    db.close()
    print("PASS: preview-before-commit, cumulative deduplication, preserved documentation/approval/discussion, idempotent confirmation, conflict protection.")


if __name__ == "__main__":
    main()
