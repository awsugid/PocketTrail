#!/usr/bin/env python3
"""Exercise the running local app using only explicitly synthetic fixtures."""

import argparse
import http.cookiejar
from html.parser import HTMLParser
import json
from pathlib import Path
import sqlite3
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid


class Inputs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.csrf = None
        self.values = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "input" and attrs.get("name"):
            self.values[attrs["name"]] = attrs.get("value", "")
        if tag == "input" and attrs.get("name") == "csrf_token":
            self.csrf = attrs.get("value")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, base):
        self.base = base
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), NoRedirect()
        )
        self.csrf = None
        self.preview_token = None
        self.revision = None

    def request(self, path, fields=None, expected=(200,), file=None):
        headers = {}
        data = None
        if fields is not None:
            pairs = list(fields)
            target = re.match(r"^(.*?/transactions/\d+)/(?:details|submit|approve|request-changes|documents|suppress|unsuppress)$", path)
            if target and self.csrf is not None and not any(k == "revision" for k, _ in pairs):
                self.request(target[1])
                if self.revision is not None:
                    pairs.append(("revision", self.revision))
            if self.csrf is not None and not any(k == "csrf_token" for k, _ in pairs):
                pairs.append(("csrf_token", self.csrf))
            if file:
                boundary = "pockettrail-" + uuid.uuid4().hex
                parts = []
                for key, value in pairs:
                    parts.extend([
                        f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n".encode(),
                        str(value).encode(), b"\r\n",
                    ])
                parts.extend([
                    f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"synthetic-receipt.pdf\"\r\nContent-Type: application/pdf\r\n\r\n".encode(),
                    file, f"\r\n--{boundary}--\r\n".encode(),
                ])
                data = b"".join(parts)
                headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
            else:
                data = urllib.parse.urlencode(pairs).encode()
                headers["Content-Type"] = "application/x-www-form-urlencoded"
            headers["Origin"] = self.base
        request = urllib.request.Request(self.base + path, data=data, headers=headers)
        try:
            response = self.opener.open(request, timeout=15)
        except urllib.error.HTTPError as response_error:
            response = response_error
        status = response.code
        body = response.read()
        assert status in expected, f"{request.get_method()} {path}: expected {expected}, got {status}"
        if response.headers.get("Content-Type", "").startswith("text/html"):
            inputs = Inputs()
            inputs.feed(body.decode())
            if inputs.csrf:
                self.csrf = inputs.csrf
            if inputs.values.get("preview_token"):
                self.preview_token = inputs.values["preview_token"]
            if "revision" in inputs.values:
                self.revision = inputs.values["revision"]
        return response.headers, body

    def login(self, user):
        self.request("/login")
        assert self.csrf, "Login challenge missing"
        self.request("/login/dev", [("user_id", user)], expected=(303,))
        self.request("/orgs")


def fixture_database(root):
    for path in (root / ".wrangler/state").rglob("*.sqlite"):
        try:
            db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
            row = db.execute(
                "SELECT is_synthetic FROM organizations WHERE slug='demo-jakarta'"
            ).fetchone()
            if row == (1,):
                return db
            db.close()
        except sqlite3.Error:
            continue
    raise AssertionError("A locally seeded synthetic database is required.")


def receipt_pdf():
    stream = b"BT /F1 12 Tf 30 100 Td (Synthetic receipt - no real purchase) Tj ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
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
    assert urllib.parse.urlsplit(base).hostname in {"localhost", "127.0.0.1", "::1"}, "Local only"
    root = Path(__file__).resolve().parent.parent
    db = fixture_database(root)
    assert db.execute("SELECT bank_id FROM transactions WHERE id=3").fetchone() == ("JPXDEMO0003",)
    org = "/org/demo-jakarta"
    txn = org + "/transactions/3"
    alice, bob, outsider = (Client(base) for _ in range(3))

    def state():
        return db.execute("SELECT status FROM transactions WHERE id=3").fetchone()[0]

    def outbox():
        return db.execute("SELECT COUNT(*) FROM notification_outbox").fetchone()[0]

    def details(explanation):
        return [
            ("explanation", explanation), ("responsible_member_id", "1"),
            ("evidence_unavailable_reason", "Synthetic fixture: no actual purchase"),
            ("split_label[]", "Synthetic cloud service"),
            ("split_amount[]", "120000"), ("split_member[]", "1"),
        ]

    alice.request("/healthz")
    alice.request(txn, expected=(303,))
    alice.request("/login/dev", [("user_id", "alice")], expected=(403,))
    alice.login("alice")
    bob.login("bob")
    outsider.login("admin")
    alice.request(org + "/settings/notifications", [("cutoff_date", "2025-01-01")], expected=(303,))
    alice.request("/org/demo-indonesia/transactions", expected=(403,))
    outsider.request(txn, expected=(403,))
    alice.request(txn)
    saved_csrf = alice.csrf
    alice.csrf = None
    alice.request(txn + "/details", details("must not save"), expected=(403,))
    alice.csrf = saved_csrf
    bob.request(txn + "/details", details("must not save"), expected=(403,))
    print("PASS: anonymous, organization, role, and CSRF boundaries")

    run = uuid.uuid4().hex[:8]
    alice.request(txn + "/details", details("Synthetic cloud subscription " + run), expected=(303,))
    # Submission may be explicit or derived from a complete pending record.
    if state() == "draft":
        alice.request(txn + "/submit", [], expected=(303,))
    alice.request(txn + "/approve", [], expected=(400, 403))
    bob.request(txn)
    bob.request(txn + "/approve", [], expected=(303,))
    assert state() == "approved", "Independent approval did not persist"
    alice.request(txn + "/comments", [("body", "Synthetic discussion @bob")], expected=(303,))
    assert state() == "approved", "Comment invalidated approval"
    alice.request(txn + "/details", details("Synthetic revised purpose " + run), expected=(303,))
    assert state() != "approved", "Substantive edit kept approval"
    bob.request(txn + "/approve", [], expected=(303,))
    print("PASS: documentation, independent approval, comment stability, and re-review")

    pdf = receipt_pdf()
    alice.request(txn + "/documents", [("note", "Synthetic evidence")], expected=(303,), file=pdf)
    assert state() != "approved", "Evidence change kept approval"
    document_id = db.execute(
        "SELECT id FROM documents WHERE transaction_id=3 ORDER BY id DESC LIMIT 1"
    ).fetchone()[0]
    _, downloaded = alice.request(org + f"/documents/{document_id}")
    assert downloaded == pdf, "Retained evidence differs"
    outsider.request(org + f"/documents/{document_id}", expected=(403,))
    print("PASS: private evidence upload, retrieval, and review invalidation")

    initial_count = outbox()
    alice.request(txn + "/comments", [("body", "Synthetic disabled mention @bob")], expected=(303,))
    assert outbox() == initial_count, "Disabled notifications generated messages"
    alice.request(org + "/settings?cutoff_date=2025-01-01")
    assert alice.preview_token, "Notification preview token missing"
    alice.request(org + "/settings/notifications", [
        ("enabled", "on"), ("cutoff_date", "2025-01-01"),
        ("preview_token", alice.preview_token)
    ], expected=(303,))
    before = outbox()
    alice.request(txn + "/comments", [("body", "Synthetic active mention @bob")], expected=(303,))
    assert outbox() > before, "Active mention not captured in local outbox"
    alice.request(txn + "/suppress", [("reason", "Synthetic suppression test")], expected=(303,))
    before = outbox()
    alice.request(txn + "/comments", [("body", "Synthetic suppressed mention @bob")], expected=(303,))
    assert outbox() == before, "Suppressed transaction generated a message"
    alice.request(txn + "/unsuppress", [], expected=(303,))
    alice.request(org + "/settings/notifications", [("cutoff_date", "2025-01-01")], expected=(303,))
    print("PASS: disabled notifications, mentions, and transaction-wide suppression")

    before_stock = db.execute("SELECT qty FROM inventory_levels WHERE item_id=1 AND location_id=1").fetchone()[0]
    alice.request(org + "/inventory/stock", [
        ("item_id", "1"), ("location_id", "1"), ("delta", "-999999"), ("reason", "Synthetic invalid adjustment")
    ], expected=(400, 409))
    assert db.execute("SELECT qty FROM inventory_levels WHERE item_id=1 AND location_id=1").fetchone()[0] == before_stock
    for delta in ("1", "-1"):
        alice.request(org + "/inventory/stock", [
            ("item_id", "1"), ("location_id", "1"), ("delta", delta), ("reason", "Synthetic smoke test")
        ], expected=(303,))
    assert db.execute("SELECT qty FROM inventory_levels WHERE item_id=1 AND location_id=1").fetchone()[0] == before_stock
    alice.request(org + "/settings/members/2/role", [("role_id", "5")], expected=(400, 403, 404))
    alice.request(org + "/settings/members/2/remove", [], expected=(303,))
    bob.request(txn, expected=(403,))
    alice.request(org + "/settings/members/2/restore", [], expected=(303,))
    bob.request(txn)
    print("PASS: stock nonnegativity, cross-org role rejection, and immediate offboarding")
    db.close()
    print("Local HTTP workflow passed. Only synthetic fixtures were changed; no email was sent.")


if __name__ == "__main__":
    main()
