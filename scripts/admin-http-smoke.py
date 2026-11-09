#!/usr/bin/env python3
"""HTTP-level admin, invitation, and audit smoke for the running local app.

Run against the seeded loopback dev server:

    python3 scripts/admin-http-smoke.py
    python3 scripts/admin-http-smoke.py \
      --db-dir /path/to/the/checkout/running/wrangler-dev

Complements scripts/local-smoke.py (workflow smoke) and
scripts/admin-self-check.py (SQL-level invitation semantics) with the HTTP
layer: platform-admin authorization, organization isolation for platform
administrators, the platform self-demotion safeguard, invitation
create/resend/revoke with delivery disabled, acceptance fail-closed guards,
and committed vs denied vs zero-row audit outcomes.

Synthetic fixtures only. Before any invitation POST, the smoke preflights
the fixture-only delivery status endpoint: /healthz, gated by the same
LOCAL_DEV + loopback predicate as dev fixture login, reports a single
email_delivery_enabled bool and nothing else. The smoke refuses unless the
running build explicitly reports false, and asserts the flag stays hidden
from a forged non-loopback Host. Older builds without the endpoint are
refused with a rebuild hint. `--preflight-only` performs only these reads.
"""

import argparse
import http.cookiejar
from html.parser import HTMLParser
import importlib.util
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request
import uuid


class Inputs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.csrf = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
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

    def request(self, path, fields=None, expected=(200,), headers=None):
        headers = dict(headers or {})
        data = None
        if fields is not None:
            pairs = list(fields)
            if self.csrf is not None and not any(k == "csrf_token" for k, _ in pairs):
                pairs.append(("csrf_token", self.csrf))
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
        return body

    def login(self, user):
        self.request("/login")
        assert self.csrf, "Login challenge missing"
        self.request("/login/dev", [("user_id", user)], expected=(303,))
        self.request("/orgs")


# Shared, deterministic helper merged from the database-selection fix
# (scripts/local-smoke.py): derives the configured D1 file from the
# wrangler.toml database id instead of scanning .wrangler/state.
_spec = importlib.util.spec_from_file_location(
    "local_smoke", Path(__file__).with_name("local-smoke.py"))
local_smoke = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(local_smoke)
fixture_database = local_smoke.fixture_database


def require_delivery_disabled(client):
    """Fixture-only status endpoint preflight: /healthz carries the single
    email_delivery_enabled bool behind the same LOCAL_DEV + loopback gates
    as dev fixture login. Invitation mutations are refused unless the
    running build explicitly reports false, and the flag must stay hidden
    from a forged non-loopback Host — exactly how a remote request
    presents itself."""
    body = client.request("/healthz").decode()
    if "email_delivery_enabled=" not in body:
        raise SystemExit(
            "REFUSED: /healthz lacks the fixture-only delivery status; "
            "rebuild and restart the dev server.")
    if "email_delivery_enabled=false" not in body:
        raise SystemExit("REFUSED: server reports email delivery enabled.")
    outside = client.request(
        "/healthz", headers={"Host": "pockettrail.example.invalid"}
    ).decode()
    assert "email_delivery_enabled=" not in outside, (
        "Delivery status leaked outside the local fixture context")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8787")
    parser.add_argument(
        "--db-dir",
        type=Path,
        default=None,
        help="Checkout running wrangler dev (defaults to this repository).",
    )
    parser.add_argument(
        "--preflight-only",
        action="store_true",
        help="Verify the launch has email delivery disabled, then exit "
        "without touching the app.",
    )
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    assert urllib.parse.urlsplit(base).hostname in {"localhost", "127.0.0.1", "::1"}, "Local only"
    root = args.db_dir.resolve() if args.db_dir else Path(__file__).resolve().parent.parent
    alice, bob, platform = (Client(base) for _ in range(3))
    require_delivery_disabled(platform)
    if args.preflight_only:
        print("PREFLIGHT PASS: the running server reports invitation email "
              "delivery disabled; no further request was made.")
        return
    db = fixture_database(root)

    def count(action, outcome, actor=None, org=None):
        sql = "SELECT COUNT(*) FROM audit_events WHERE action=? AND outcome=?"
        params = [action, outcome]
        if actor is not None:
            sql += " AND actor_id=?"
            params.append(actor)
        if org is not None:
            sql += " AND org_id=?"
            params.append(org)
        return db.execute(sql, params).fetchone()[0]

    jakarta = "/org/demo-jakarta"
    indonesia = "/org/demo-indonesia"

    # Fixture guard: users without a verified Google sub cannot pass the
    # verified-Google acceptance guard, which the invitation sections below
    # assert stays fail-closed.
    assert db.execute(
        "SELECT COUNT(*) FROM users WHERE google_sub IS NOT NULL"
    ).fetchone()[0] == 0, "Fixture database must contain fixture users only"

    logins_before = count("auth.login", "committed", actor="alice")
    alice.login("alice")
    bob.login("bob")
    platform.login("admin")
    assert count("auth.login", "committed", actor="alice") > logins_before, (
        "Login events are not landing in the inspected database; the running "
        "server uses a different D1 file. Pass --db-dir with its checkout."
    )

    # --- platform admin-only surface vs organization isolation
    bob.request("/platform", expected=(403,))
    alice.request("/platform")
    platform.request("/platform")
    platform.request(jakarta + "/transactions", expected=(403,))
    platform.request(indonesia + "/transactions", expected=(403,))
    bob.request("/platform/users/admin", [("user_id", "alice"), ("admin", "false")], expected=(403,))
    bob.request("/platform/role-templates", [("name", "Synthetic smoke")], expected=(403,))
    platform.request("/platform/users/admin", [("user_id", "admin"), ("admin", "false")], expected=(400,))
    platform.request("/platform/users/admin", [("user_id", "alice"), ("admin", "bogus")], expected=(400,))
    platform.request("/platform/users/admin", [("user_id", "ghost-user"), ("admin", "true")], expected=(404,))
    # Authorized grant/revoke now applies to fixture users: exercise the real
    # transition and its audit outcomes, restoring alice via the second
    # administrator in finally. No-op/sole-admin/race blocks stay SQL-level
    # (admin-self-check.py): HTTP cannot reach zero-remaining-admins without
    # the 400'd self-change.
    granted0 = count("platform.admin", "granted")
    revoked0 = count("platform.admin", "revoked")
    failure = None
    try:
        platform.request("/platform/users/admin", [("user_id", "alice"), ("admin", "false")], expected=(303,))
        assert db.execute(
            "SELECT is_platform_admin FROM users WHERE id='alice'"
        ).fetchone()[0] == 0, "Authorized demotion did not persist"
        assert count("platform.admin", "revoked") == revoked0 + 1, "Demotion not audited"
        alice.request("/platform", expected=(403,))
    except AssertionError as error:
        failure = error
    finally:
        if db.execute(
            "SELECT is_platform_admin FROM users WHERE id='alice'"
        ).fetchone()[0] != 1:
            platform.request("/platform/users/admin", [("user_id", "alice"), ("admin", "true")], expected=(303,))
        assert db.execute(
            "SELECT is_platform_admin FROM users WHERE id='alice'"
        ).fetchone()[0] == 1, "Cleanup failed: fixture alice is not a platform admin"
        assert count("platform.admin", "granted") == granted0 + 1, "Re-grant not audited"
        alice.request("/platform")
    if failure is not None:
        raise failure
    print("PASS: platform admin-only surface and organization isolation")

    # --- invitation lifecycle in demo-jakarta (alice manages)
    email = f"invite-{uuid.uuid4().hex[:8]}@example.test"
    created0 = count("invitation.created", "committed", actor="alice", org=1)
    resent0 = count("invitation.resent", "committed", actor="alice", org=1)
    revoked0 = count("invitation.revoked", "committed", actor="alice", org=1)
    denied0 = count("http.post", "denied", actor="bob", org=1)

    bob.request(jakarta + "/settings/invitations", [("email", email), ("role_id", "2")], expected=(403,))
    platform.request(jakarta + "/settings/invitations", [("email", email), ("role_id", "2")], expected=(403,))
    assert count("http.post", "denied", actor="bob", org=1) == denied0 + 1, "Denied invitation POST not audited"
    assert count("invitation.created", "committed", actor="alice", org=1) == created0

    alice.request(jakarta + "/settings/invitations", [("email", email), ("role_id", "2")], expected=(303,))
    assert count("invitation.created", "committed", actor="alice", org=1) == created0 + 1
    invitation_id, = db.execute(
        "SELECT id FROM invitations WHERE org_id=1 AND email=? AND revoked_at IS NULL", (email,)
    ).fetchone()
    status, error, attempts = db.execute(
        "SELECT status,error,attempts FROM invitation_mail WHERE invitation_id=?", (invitation_id,)
    ).fetchone()
    assert (status, attempts) == ("pending", 0), f"Delivery row not pending-disabled: {status}, {attempts}"
    assert error and "Email delivery is disabled" in error, f"Unexpected delivery state: {error!r}"
    body = alice.request(jakarta + "/settings")
    assert email.encode() in body, "Created invitation missing from settings page"

    alice.request(jakarta + "/settings/invitations", [("email", email), ("role_id", "5")], expected=(400,))
    alice.request(jakarta + "/settings/invitations", [("email", "alice@example.test"), ("role_id", "2")], expected=(400,))
    assert count("invitation.created", "committed", actor="alice", org=1) == created0 + 1, "Rejected create was audited"

    alice.request(jakarta + f"/settings/invitations/{invitation_id}/resend", [], expected=(303,))
    assert count("invitation.resent", "committed", actor="alice", org=1) == resent0 + 1
    rows = db.execute(
        "SELECT status FROM invitation_mail WHERE invitation_id=? ORDER BY id", (invitation_id,)
    ).fetchall()
    assert [r[0] for r in rows] == ["superseded", "pending"], f"Resend did not supersede: {rows}"
    bob.request(jakarta + f"/settings/invitations/{invitation_id}/resend", [], expected=(403,))
    platform.request(jakarta + f"/settings/invitations/{invitation_id}/resend", [], expected=(403,))

    # Acceptance stays fail-closed for fixture users (no verified Google
    # sub, which production deliberately does not mock): wrong recipient,
    # right recipient, and platform admin all hit the same guard.
    bob.request(f"/invitations/{invitation_id}/accept", [], expected=(403,))
    alice.request(f"/invitations/{invitation_id}/accept", [], expected=(403,))
    platform.request(f"/invitations/{invitation_id}/accept", [], expected=(403,))
    alice.request("/invitations/accept?token=synthetic-invalid-token", expected=(404,))
    assert db.execute(
        "SELECT accepted_at, revoked_at FROM invitations WHERE id=?", (invitation_id,)
    ).fetchone() == (None, None)

    bob.request(jakarta + f"/settings/invitations/{invitation_id}/revoke", [], expected=(403,))
    alice.request(jakarta + f"/settings/invitations/{invitation_id}/revoke", [], expected=(303,))
    assert count("invitation.revoked", "committed", actor="alice", org=1) == revoked0 + 1
    assert db.execute(
        "SELECT COUNT(*) FROM invitations WHERE id=? AND revoked_at IS NOT NULL", (invitation_id,)
    ).fetchone()[0] == 1
    # Zero-row idempotence: revoking twice writes one committed audit row.
    alice.request(jakarta + f"/settings/invitations/{invitation_id}/revoke", [], expected=(303,))
    assert count("invitation.revoked", "committed", actor="alice", org=1) == revoked0 + 1, "Double revoke was audited twice"
    alice.request(jakarta + f"/settings/invitations/{invitation_id}/resend", [], expected=(404,))
    assert count("invitation.resent", "committed", actor="alice", org=1) == resent0 + 1
    assert db.execute(
        "SELECT COUNT(*) FROM invitation_mail WHERE invitation_id=?", (invitation_id,)
    ).fetchone()[0] == 2, "Closed invitation gained a delivery row"
    print("PASS: invitation create, disabled delivery, resend, guards, revoke")

    # --- the same surface from bob's own organization (positive isolation)
    alice.request(indonesia + "/settings", expected=(403,))
    body = bob.request(indonesia + "/settings")
    assert b"Create invitation" in body
    iemail = f"invite-{uuid.uuid4().hex[:8]}@example.test"
    created_bob0 = count("invitation.created", "committed", actor="bob", org=2)
    revoked_bob0 = count("invitation.revoked", "committed", actor="bob", org=2)
    bob.request(indonesia + "/settings/invitations", [("email", iemail), ("role_id", "5")], expected=(303,))
    assert count("invitation.created", "committed", actor="bob", org=2) == created_bob0 + 1
    iinvitation_id, = db.execute(
        "SELECT id FROM invitations WHERE org_id=2 AND email=? AND revoked_at IS NULL", (iemail,)
    ).fetchone()
    istatus, = db.execute(
        "SELECT status FROM invitation_mail WHERE invitation_id=?", (iinvitation_id,)
    ).fetchone()
    assert istatus == "pending"
    bob.request(indonesia + f"/settings/invitations/{iinvitation_id}/revoke", [], expected=(303,))
    assert count("invitation.revoked", "committed", actor="bob", org=2) == revoked_bob0 + 1
    print("PASS: invitation management scoped to the manager's organization")

    db.close()
    print("Admin/invitation HTTP smoke passed. Only synthetic fixtures changed; no email was sent.")


if __name__ == "__main__":
    main()
