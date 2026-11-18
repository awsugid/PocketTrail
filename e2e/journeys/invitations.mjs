// Invitation acceptance journey: the two real acceptance paths after a
// normal Google sign-in by the invitee — in-app from Organizations and the
// single-use emailed link. Google itself cannot run here, so a verified
// sign-in is simulated exactly as the google action leaves the database:
// the placeholder user claimed by a Google subject, plus a session cookie
// minted with the same codec as src/lib/server/session.ts.
import { createHash } from 'node:crypto';
import { Client, ORIGIN, SECRET, run } from '../harness.mjs';
import { csrfFrom, signIn } from './_util.mjs';

const encoder = new TextEncoder();

async function hmacHex(secret, data) {
        const key = await crypto.subtle.importKey(
                'raw',
                encoder.encode(secret),
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                ['sign']
        );
        const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
        return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Mirrors newSession + encodeCookie in src/lib/server/session.ts. */
async function sessionCookie(uid) {
        const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
        const csrf = (await hmacHex(SECRET, `csrf:${uid}:${exp}`)).slice(0, 32);
        const payload = btoa(JSON.stringify({ uid, csrf, exp })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        return `pt_session=${payload}.${await hmacHex(SECRET, payload)}`;
}

async function d1(sql) {
        const out = run('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command', sql]);
        return JSON.parse(out)[0].results;
}

/** Claim the invitee's placeholder exactly as the verified Google sign-in
 * does, and return a client signed in as that user. */
async function googleSignInOf(email, subject) {
        const rows = await d1(`SELECT id FROM users WHERE email='${email}' COLLATE NOCASE`);
        if (rows.length !== 1 || !rows[0].id.startsWith('invite:')) {
                throw new Error(`expected one placeholder user for ${email}, got ${JSON.stringify(rows)}`);
        }
        await d1(`UPDATE users SET google_sub='${subject}' WHERE id='${rows[0].id}'`);
        const client = new Client();
        const cookie = await sessionCookie(rows[0].id);
        return {
                client,
                cookieHeader: cookie,
                get: (path) => client.request(path, { headers: { cookie } }),
                postForm: (path, fields) =>
                        client.request(path, {
                                method: 'POST',
                                headers: {
                                        'content-type': 'application/x-www-form-urlencoded',
                                        accept: 'text/html',
                                        origin: ORIGIN,
                                        cookie
                                },
                                body: new URLSearchParams(fields)
                        })
        };
}

export async function checks(ctx) {
        const { extractCsrf } = ctx;
        let failures = 0;
        const check = (name, condition, detail = '') => {
                if (condition) process.stdout.write(`  ok   ${name}\n`);
                else {
                        failures += 1;
                        process.stdout.write(`  FAIL ${name}${detail ? ` — ${detail}` : ''}\n`);
                }
        };

        const alice = new Client();
        await signIn(alice, extractCsrf, 'alice');
        const csrf = csrfFrom(await (await alice.get('/org/demo-jakarta/settings/pockets')).text()) ?? '';

        // ------------------------------------------- in-app acceptance from /orgs
        const invited = await alice.postForm('/org/demo-jakarta/settings/invitations', {
                csrf_token: csrf,
                email: 'joiner@example.test',
                role_id: '4'
        });
        check('joiner is invited', invited.status === 303, String(invited.status));

        // The invitee signs in normally with Google (never having accepted)
        // and lands on Organizations.
        const joiner = await googleSignInOf('joiner@example.test', 'journey-sub-joiner');
        const orgs = await joiner.get('/orgs');
        const orgsHtml = await orgs.text();
        check('organizations lists the invitation', orgs.status === 200 && orgsHtml.includes('joiner@example.test'), `${orgs.status}`);
        const invitationId = orgsHtml.match(/\/invitations\/([0-9a-f]{32,64})\/accept/)?.[1] ?? '';
        check('the invitation card exposes an accept control', invitationId !== '', 'no invitation id');
        check(
                'the invitation card names the organization and role',
                orgsHtml.includes('Jakarta') && /Approver|Admin/.test(orgsHtml) && !/>undefined</.test(orgsHtml) && !orgsHtml.includes('NaN'),
                'card labels missing or undefined'
        );
        const joinerCsrf = extractCsrf(orgsHtml) ?? '';

        const accepted = await joiner.postForm(`/invitations/${invitationId}/accept`, {
                csrf_token: joinerCsrf
        });
        check('in-app acceptance succeeds', accepted.status === 303, String(accepted.status));

        const after = await joiner.get('/orgs');
        const afterHtml = await after.text();
        check('the accepted invitation leaves the list', !afterHtml.includes('/invitations/'));
        check('the accepted organization is listed', afterHtml.includes('demo-jakarta'));

        const dbAfter = await d1(
                "SELECT (SELECT COUNT(*) FROM invitations WHERE email='joiner@example.test' AND accepted_at IS NULL) AS open_invitations, (SELECT invited FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email='joiner@example.test' AND m.org_id=1) AS invited_flag"
        );
        check(
                'acceptance closes the invitation and clears the invited flag',
                dbAfter[0].open_invitations === 0 && dbAfter[0].invited_flag === 0,
                JSON.stringify(dbAfter[0])
        );

        const people = await (await alice.get('/org/demo-jakarta/settings/people')).text();
        const membersList = people.split('id="invitations-heading"')[0].split('id="members-heading"')[1] ?? '';
        const joinerRow = membersList.split('<li').find((row) => row.includes('joiner@example.test')) ?? '';
        check("the member row no longer shows Invited", joinerRow !== '' && !joinerRow.includes('>Invited<'), joinerRow.slice(0, 120));
        check('the people page no longer lists the invitation', !(people.split('invitations-heading')[1] ?? '').includes('joiner@example.test'));

        // ------------------------------------------- emailed-link acceptance
        const invitedLink = await alice.postForm('/org/demo-jakarta/settings/invitations', {
                csrf_token: csrf,
                email: 'linker@example.test',
                role_id: '4'
        });
        check('linker is invited', invitedLink.status === 303, String(invitedLink.status));

        // A delivered link: a known token whose SHA-256 hash marks the mail
        // row sent, exactly as deliverMail records a successful send.
        const token = 'journeytokenjourneytokenjourney12';
        const tokenHash = createHash('sha256').update(token).digest('hex');
        await d1(
                `UPDATE invitation_mail SET status='sent', token_hash='${tokenHash}' WHERE invitation_id=(SELECT id FROM invitations WHERE email='linker@example.test' AND accepted_at IS NULL)`
        );

        const linker = await googleSignInOf('linker@example.test', 'journey-sub-linker');
        const linkPage = await linker.get(`/invitations/accept?token=${token}`);
        const linkHtml = await linkPage.text();
        check('the emailed link opens for the matching signed-in invitee', linkPage.status === 200 && linkHtml.includes('Join'), `${linkPage.status}`);
        const linkerCsrf = extractCsrf(linkHtml) ?? '';

        const acceptedLink = await linker.postForm('/invitations/accept?/accept', {
                csrf_token: linkerCsrf,
                token
        });
        check('emailed-link acceptance succeeds', acceptedLink.status === 303, String(acceptedLink.status));

        const linkAfter = await d1(
                "SELECT (SELECT COUNT(*) FROM invitations WHERE email='linker@example.test' AND accepted_at IS NULL) AS open_invitations, (SELECT invited FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email='linker@example.test' AND m.org_id=1) AS invited_flag"
        );
        check(
                'link acceptance closes the invitation and clears the invited flag',
                linkAfter[0].open_invitations === 0 && linkAfter[0].invited_flag === 0,
                JSON.stringify(linkAfter[0])
        );

        // ------------------------------------------- never-accepted sign-in state
        await alice.postForm('/org/demo-jakarta/settings/invitations', {
                csrf_token: csrf,
                email: 'silent@example.test',
                role_id: '4'
        });
        const silent = await googleSignInOf('silent@example.test', 'journey-sub-silent');
        const silentOrgs = await silent.get('/orgs');
        const silentHtml = await silentOrgs.text();
        check('a never-accepted invitee still sees the invitation', silentHtml.includes('/invitations/') && silentHtml.includes('silent@example.test'));
        check('a never-accepted invitee has no organization access', !(await silent.get('/org/demo-jakarta/transactions')).status.toString().startsWith('2'));
        const silentDb = await d1(
                "SELECT invited FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email='silent@example.test' AND m.org_id=1"
        );
        check('a never-accepted invitee stays invited', silentDb[0].invited === 1, JSON.stringify(silentDb[0]));

        return failures;
}
