"""Run: python3 scripts/admin-self-check.py. Synthetic SQLite integration checks.

Extracts the real handler SQL from src/web/invitations.rs and exercises it:
organization role isolation, acceptance (grant/accept/audit atomicity),
replay-after-acceptance, replay-after-removal, expiry, revocation, emailed
token lifecycle (hash-only storage, superseded links, sent-only redemption),
conditional audit rows, and append-only audit storage."""
import hashlib
import re
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parent.parent
db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for migration in sorted((root / 'migrations').glob('*.sql')):
    db.executescript(migration.read_text())
db.executescript("""
INSERT INTO users(id,email,name,google_sub,created_at) VALUES
 ('admin','admin@example.test','Admin','admin',0),
 ('guest','guest@example.test','Guest','guest',0),
 ('other','other@example.test','Other','other',0);
INSERT INTO organizations(id,slug,name,created_at) VALUES(1,'one','One',0),(2,'two','Two',0);
INSERT INTO roles(id,org_id,name,permissions) VALUES(1,1,'Viewer','["ViewTransactions"]'),(2,2,'Viewer','[]');
INSERT INTO invitations(id,org_id,email,role_id,invited_by,created_at,expires_at)
 VALUES('invite',1,'GUEST@example.test',1,'admin',0,1000);
""")

def h(token):
    return hashlib.sha256(token.encode()).hexdigest()

try:
    db.execute("INSERT INTO invitations(id,org_id,email,role_id,invited_by,created_at,expires_at) VALUES('wrong',1,'x@example.test',2,'admin',0,1000)")
    raise AssertionError('Cross-org role admitted')
except sqlite3.IntegrityError:
    pass

source = (root / 'src/web/invitations.rs').read_text()
mail_source = (root / 'src/web/invitation_mail.rs').read_text()
smtp_source = (root / 'src/smtp.rs').read_text()
prep = re.findall(r'prepare\(\s*"([^"]+)"', source + '\n' + mail_source)
prep += re.findall(r'exec\(\s*\n?\s*db,\s*"([^"]+)"', mail_source)
qone = re.findall(r'q_one\(\s*db,\s*"([^"]+)"', source, re.S)
insert = next(q for q in prep if q.startswith('INSERT INTO memberships') and 'invitation_mail' not in q)
accept = next(q for q in prep if q.startswith('UPDATE invitations SET accepted_at') and 'invitation_mail' not in q)
gate_insert = next(q for q in prep if q.startswith('INSERT INTO memberships') and 'invitation_mail' in q)
gate_accept = next(q for q in prep if q.startswith('UPDATE invitations SET accepted_at') and 'invitation_mail' in q)
accept_audit = next(q for q in prep if "'invitation.accepted'" in q)
revoke = next(q for q in prep if q.startswith('UPDATE invitations SET revoked_at') and 'WHERE id=?2' in q)
revoke_audit = next(q for q in prep if "'invitation.revoked'" in q)
supersede = next(q for q in prep if q.startswith("UPDATE invitation_mail SET status='superseded'"))
mail_insert = next(q for q in prep if q.startswith('INSERT INTO invitation_mail'))
token_sql = next(q for q in qone if q.startswith('SELECT im.invitation_id'))
mark_sql = next(q for q in prep if q.startswith('UPDATE invitation_mail SET status=?'))
# Late send completion must never resurrect a superseded/failed row.
assert "status='pending'" in mark_sql, 'mark() lacks pending-only guard'
# SMTP errors carry stage + status code only, never server reply text.
expect_body = smtp_source.split('pub async fn expect')[1].split('\n}')[0]
assert '.lines' not in expect_body, 'expect() echoes server text'

def rows(sql, *params):
    return db.execute(sql, params).fetchall()

def audit_count(action):
    return rows("SELECT count(*) FROM audit_events WHERE outcome='committed' AND action=?", action)[0][0]

def token_target(token, now):
    return rows(token_sql, h(token), now)

# --- emailed token lifecycle: hash-only storage, supersede, sent-only use
db.execute(mail_insert, ('invite', h('tokA'), 0))
assert rows("SELECT count(*) FROM invitation_mail WHERE token_hash=?", h('tokA'))[0][0] == 1
assert token_target('tokA', 10) == []          # pending rows cannot redeem
db.execute("UPDATE invitation_mail SET status='sent' WHERE token_hash=?", (h('tokA'),))
assert token_target('tokA', 10)                # sent on open invitation
assert token_target('tokA', 1001) == []        # expired invitation

# Late send completion (mark) cannot resurrect a superseded link.
def mark(hash, status, error, sent_at):
    db.execute(mark_sql, ('invite', hash, status, error, sent_at))
mark(h('tokA'), 'superseded_later', None, None)  # simulate resend superseding
db.execute(supersede, ('invite', 1, 10))
late = db.execute(mark_sql, ('invite', h('tokA'), 'sent', None, 99)).rowcount
assert late == 0, 'late send completion must affect 0 rows'
assert rows("SELECT status FROM invitation_mail WHERE token_hash=?", h('tokA'))[0][0] == 'superseded'

db.execute(mail_insert, ('invite', h('tokB'), 5))
assert token_target('tokA', 10) == []          # superseded link is dead
assert token_target('tokB', 10) == []          # new link pending, cannot redeem
db.execute("UPDATE invitation_mail SET status='sent' WHERE token_hash=?", (h('tokB'),))
assert token_target('tokB', 10)

try:
    db.execute("INSERT INTO invitation_mail(invitation_id,token_hash,status,created_at) VALUES('invite',?,'bogus',0)", (h('x'),))
    raise AssertionError('Invalid delivery status admitted')
except sqlite3.IntegrityError:
    pass

# --- acceptance: grant, accept, conditional audit in one transaction
def attempt(uid, email, now):
    with db:
        db.execute(insert, (uid, now, 'invite', email))
        db.execute(accept, (now, uid, 'invite', email))
        db.execute(accept_audit, (uid, '/invitations/accept', 'invite', now))

attempt('other', 'other@example.test', 10)
assert rows('SELECT count(*) FROM memberships')[0][0] == 0
assert audit_count('invitation.accepted') == 0   # wrong recipient: no audit row
attempt('guest', 'guest@example.test', 1001)
assert rows('SELECT count(*) FROM memberships')[0][0] == 0
assert audit_count('invitation.accepted') == 0   # expired: no audit row
db.execute("UPDATE invitations SET revoked_at=1")
attempt('guest', 'guest@example.test', 10)
assert rows('SELECT count(*) FROM memberships')[0][0] == 0
assert audit_count('invitation.accepted') == 0   # revoked: no audit row
db.execute('UPDATE invitations SET revoked_at=NULL')
attempt('guest', 'guest@example.test', 10)
assert rows('SELECT count(*) FROM memberships')[0][0] == 1
assert rows('SELECT accepted_by FROM invitations')[0][0] == 'guest'
assert audit_count('invitation.accepted') == 1   # real transition audited
attempt('guest', 'guest@example.test', 30)
assert audit_count('invitation.accepted') == 1   # replay: nothing new
attempt('guest', 'guest@example.test', 10)
assert audit_count('invitation.accepted') == 1   # same-ms replay: changes()-gate still blocks
db.execute('UPDATE memberships SET removed_at=20')
attempt('guest', 'guest@example.test', 30)
assert rows('SELECT removed_at FROM memberships')[0][0] == 20
assert audit_count('invitation.accepted') == 1   # replay cannot restore

# --- emailed-link acceptance is gated on the token inside the atomic batch:
# a concurrent resend that supersedes the token between the pre-check
# (token_target) and the batch makes grant AND accept write nothing.
def token_attempt(uid, email, now, token, invitation='invite'):
    with db:
        db.execute(gate_insert, (uid, now, invitation, email, h(token)))
        db.execute(gate_accept, (now, uid, invitation, email, h(token)))
        db.execute(accept_audit, (uid, '/invitations/accept', invitation, now))

# Restore a fresh open invitation for token tests.
db.executescript("""
INSERT INTO invitations(id,org_id,email,role_id,invited_by,created_at,expires_at)
 VALUES('inv3',1,'link@example.test',1,'admin',0,1000);
INSERT INTO invitation_mail(invitation_id,token_hash,status,created_at)
 VALUES('inv3','%s','sent',0);
""" % h('tokLive'))

token_attempt('other', 'LINK@example.test', 10, 'tokLive', 'inv3')
assert rows("SELECT count(*) FROM memberships WHERE user_id='other'")[0][0] == 1  # link grant
assert audit_count('invitation.accepted') == 2

# Concurrent resend supersedes tokLive; the in-flight token batch now no-ops.
db.execute(supersede, ('inv3', 1, 10))
db.execute(mail_insert, ('inv3', h('tokNew'), 6))
with db:
    db.execute(gate_insert, ('other', 10, 'inv3', 'link@example.test', h('tokLive')))
    db.execute(gate_accept, (10, 'other', 'inv3', 'link@example.test', h('tokLive')))
    db.execute(accept_audit, ('other', '/invitations/accept', 'inv3', 10))
assert rows("SELECT count(*) FROM memberships WHERE user_id='other'")[0][0] == 1
assert audit_count('invitation.accepted') == 2   # stale token: no grant, no audit

# Wrong recipient who is ALREADY an active member of the org must not get a
# false success: the acceptance UPDATE still writes 0 (email mismatch), which
# is the D1 `changes` the handler now requires for success.
wrong = db.execute(gate_accept, (10, 'other', 'inv3', 'link@example.test', h('tokNew'))).rowcount
assert wrong == 0

# --- resend batch revalidates atomically: closed invitation => no supersede,
# no new delivery row, no audit event.
resent_audit = next(q for q in prep if "'invitation.resent'" in q)
gated_mail_insert = next(q for q in prep if q.startswith('INSERT INTO invitation_mail') and 'WHERE EXISTS' in q)

def resend_batch(inv, org, now, token_hash, actor='admin', target='/org/one/settings/invitations/x/resend'):
    db.execute(supersede, (inv, org, now))
    n = db.execute(gated_mail_insert, (inv, token_hash, now, org)).rowcount
    if n == 1:
        db.execute(resent_audit, (actor, target, inv, org, now))
    return n

db.execute("INSERT INTO invitations(id,org_id,email,role_id,invited_by,created_at,expires_at) VALUES('inv4',1,'y@example.test',1,'admin',0,1000)")
n = resend_batch('inv4', 1, 10, h('tokNew'))
assert n == 1 and audit_count('invitation.resent') == 1   # open invitation: row + audit
# Now close inv4 by revocation; a resend racing after it must no-op entirely.
db.execute(revoke, (60, 'inv4', 1))
db.execute(revoke_audit, ('admin', '/org/one/settings/invitations/inv4/revoke', 'inv4', 1, 60))
n = resend_batch('inv4', 1, 10, h('tokLate'))
assert n == 0 and audit_count('invitation.resent') == 1   # closed: nothing written

# --- revocation: audit row only when this statement actually revoked
db.execute("INSERT INTO invitations(id,org_id,email,role_id,invited_by,created_at,expires_at) VALUES('inv2',1,'x@example.test',1,'admin',0,1000)")
db.execute(revoke, (50, 'inv2', 1))
db.execute(revoke_audit, ('admin', '/org/one/settings/invitations/inv2/revoke', 'inv2', 1, 50))
assert audit_count('invitation.revoked') == 2  # inv4 (resend close-out) + inv2
db.execute(revoke, (60, 'inv2', 1))              # already revoked: 0 rows
db.execute(revoke_audit, ('admin', '/org/one/settings/invitations/inv2/revoke', 'inv2', 1, 60))
assert audit_count('invitation.revoked') == 2    # no duplicate committed row

# --- audit events cannot be rewritten or erased, even by application SQL
db.execute("INSERT INTO audit_events(action,target,outcome,created_at) VALUES('test','synthetic','attempt',0)")
for sql in ["UPDATE audit_events SET outcome='changed'", 'DELETE FROM audit_events']:
    try:
        db.execute(sql)
        raise AssertionError('Audit record modified')
    except sqlite3.IntegrityError:
        pass
print('Invitation isolation, expiry, revocation, acceptance, replay, token lifecycle, conditional audit, append-only audit: PASS')
# Platform administration: the guarded statements and the authorization
# probe are extracted from src/web/platform.rs, so the regression runs the
# exact SQL the handler ships. Covers verified Google admins, no-op
# grant/revoke truthfulness, the sole-admin block, racing demotions, and a
# revoked actor whose paused grant/save must apply nothing and audit nothing.
source_platform = (root / 'src/web/platform.rs').read_text()

def const_str(name):
    return re.search(r'let ' + name + r'\s*=\s*"([^"]+)"', source_platform).group(1)

actor_guards = re.findall(r'let actor_guard\s*=\s*"([^"]+)"', source_platform)
actor_guard = actor_guards[0]  # set_admin: actor is bind ?2
save_actor_guard = actor_guards[1]  # save_template: actor is bind ?3
count_guard = re.search(
    r'let count_guard = if enabled \{\s*"1=1"\.to_string\(\)\s*\} else \{\s*"([^"]+)"\.to_string\(\)',
    source_platform,
).group(1)
audit_tpl = next(q for q in re.findall(r'"(INSERT INTO audit_events[^"]+)"', source_platform)
                 if 'platform.admin' in q)
update_tpl = next(q for q in re.findall(r'"(UPDATE users SET is_platform_admin[^"]+)"', source_platform))
probe_tpl = next(q for q in re.findall(r'"(SELECT EXISTS\(SELECT 1 FROM users WHERE id=\?1[^"]+)"', source_platform)
                 if 'target_is_requested' in q)
save_tpl = next(q for q in re.findall(r'"(INSERT INTO role_templates[^"]+)"', source_platform))
save_audit_tpl = next(q for q in re.findall(r'"(INSERT INTO audit_events[^"]+)"', source_platform)
                      if 'changes()' in q)

def admin_db():
    d = sqlite3.connect(':memory:')
    d.execute('PRAGMA foreign_keys=ON')
    for migration in sorted((root / 'migrations').glob('*.sql')):
        d.executescript(migration.read_text())
    d.executescript("""
    INSERT INTO users(id,email,name,google_sub,is_platform_admin,created_at) VALUES
     ('g1','g1@example.test','Google One','g-sub-1',1,0),
     ('g2','g2@example.test','Google Two','g-sub-2',1,0),
     ('g3','g3@example.test','Google Three','g-sub-3',0,0);
    """)
    return d

def attempt(d, uid, enabled, actor='g1'):
    """Run the handler's atomic batch; return (changed, actor_admin, target_state)."""
    guards = {'{actor_guard}': actor_guard, '{count_guard}': count_guard if not enabled else '1=1'}
    audit_sql, update_sql = audit_tpl, update_tpl
    for k, v in guards.items():
        audit_sql = audit_sql.replace(k, v)
        update_sql = update_sql.replace(k, v)
    with d:
        d.execute(audit_sql, (uid, actor, 'granted' if enabled else 'revoked', 0, int(enabled)))
        cur = d.execute(update_sql, (uid, actor, int(enabled)))
        changed = cur.rowcount
        probe = d.execute(probe_tpl, (actor, uid, int(enabled))).fetchone()
    return changed, probe[0], probe[1]

def admins(d):
    return d.execute('SELECT id FROM users WHERE is_platform_admin=1 ORDER BY id').fetchall()

def audit_rows(d):
    return d.execute("SELECT target,outcome FROM audit_events WHERE action='platform.admin'").fetchall()

d = admin_db()
# Grant the non-admin: applied and audited.
changed, actor_admin, target = attempt(d, 'g3', True)
assert (changed, actor_admin, target) == (1, 1, 1)
assert sorted(admins(d)) == [('g1',), ('g2',), ('g3',)]
assert audit_rows(d) == [('g3', 'granted')]

# No-op grant: zero changes, zero audit rows, success via target state.
assert attempt(d, 'g3', True) == (0, 1, 1)
assert audit_rows(d) == [('g3', 'granted')]

# Sole-admin block: demoting the final administrator cannot apply.
d.execute("UPDATE users SET is_platform_admin=CASE WHEN id='g1' THEN 1 ELSE 0 END")
assert attempt(d, 'g1', False) == (0, 1, 0)
assert admins(d) == [('g1',)]
assert audit_rows(d) == [('g3', 'granted')]

# Revoked actor: a paused grant paused before the actor's own demotion must
# neither apply nor audit, and reports unauthorized from the probe.
d.execute("UPDATE users SET is_platform_admin=1 WHERE id='g3'")
d.execute("UPDATE users SET is_platform_admin=0 WHERE id='g1'")
assert attempt(d, 'g3', True) == (0, 0, 1)
assert attempt(d, 'g2', False, actor='g1') == (0, 0, 1)
assert audit_rows(d) == [('g3', 'granted')]
d.close()

# Racing demotions serialized by SQLite: the first applies; the second
# request's actor was demoted by the first, so the actor guard rejects it
# (the sole-admin count guard is covered separately above). Audit events are
# append-only, so the race runs on a fresh database.
d = admin_db()
d.execute("UPDATE users SET is_platform_admin=1 WHERE id IN ('g1','g2')")
assert attempt(d, 'g1', False)[0] == 1
assert attempt(d, 'g2', False, actor='g2') == (0, 1, 0)
assert admins(d) == [('g2',)]
assert audit_rows(d) == [('g1', 'revoked')]
assert attempt(d, 'g2', False, actor='g2') == (0, 1, 0)
assert audit_rows(d) == [('g1', 'revoked')]
d.close()

# save_template: successful save audits; a revoked actor's save changes
# nothing, writes no audit row, and creates no template.
d = admin_db()
def save(d, name, permissions, actor='g1'):
    upsert = save_tpl.replace('{actor_guard}', save_actor_guard)
    with d:
        cur = d.execute(upsert, (name, permissions, actor))
        d.execute(save_audit_tpl, (actor, name, 0))
    return cur.rowcount

assert save(d, 'Treasurer', '["ViewTransactions"]') == 1
assert d.execute("SELECT count(*) FROM audit_events WHERE action='platform.template'").fetchone()[0] == 1
assert save(d, 'Treasurer', '["ViewTransactions"]') == 1  # SQLite counts a
# same-value DO UPDATE as a change, so the changes()-gated audit records it.
assert d.execute("SELECT count(*) FROM role_templates").fetchone()[0] == 1
assert d.execute("SELECT count(*) FROM audit_events WHERE action='platform.template'").fetchone()[0] == 2
d.execute("UPDATE users SET is_platform_admin=0 WHERE id='g1'")
assert save(d, 'Sneaky', '["ApproveTransactions"]') == 0
assert d.execute("SELECT count(*) FROM role_templates").fetchone()[0] == 1
assert d.execute("SELECT count(*) FROM audit_events WHERE action='platform.template'").fetchone()[0] == 2
d.close()
print('Platform admin grants: no-op truthfulness, sole-admin guard, racing demotions, revoked-actor guard: PASS')
