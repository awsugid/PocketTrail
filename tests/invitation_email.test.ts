import { describe, expect, it } from 'vitest';
import { invitationMessage } from '$lib/server/invitation_email';

const invitation = {
	email: 'guest@example.test',
	organization: 'Synthetic Community',
	role: 'Inventory Maintainer',
	expiresAt: Date.UTC(2026, 10, 23, 7, 35),
	acceptUrl: 'https://pocket.example.test/invitations/accept?token=synthetic-token'
};

describe('invitation email', () => {
	it('provides branded HTML and equivalent plain text with the same acceptance link', () => {
		const message = invitationMessage(invitation);
		expect(message.to).toBe(invitation.email);
		expect(message.subject).toBe('Join Synthetic Community on PocketTrail');
		expect(message.html).toContain('Accept invitation</a>');
		expect(message.html).toContain(`href="${invitation.acceptUrl}"`);
		for (const content of [message.body, message.html]) {
			expect(content).toContain(invitation.organization);
			expect(content).toContain(invitation.role);
			expect(content).toContain(invitation.email);
			expect(content).toContain('23 Nov 2026, 14:35 WIB (UTC+07:00)');
			expect(content).toContain('Financial details stay in PocketTrail');
		}
		expect(message.body).toContain(invitation.acceptUrl);
		expect(message.html).toContain('role="presentation"');
		expect(message.html).not.toMatch(/<script|<img|<link|@import/i);
	});

	it('uses the Jakarta calendar date when expiry crosses midnight there', () => {
		const message = invitationMessage({ ...invitation, expiresAt: Date.UTC(2026, 10, 23, 20, 35) });
		for (const content of [message.body, message.html]) {
			expect(content).toContain('24 Nov 2026, 03:35 WIB (UTC+07:00)');
		}
	});

	it('centers the wordmark, content, button and footer with email-compatible alignment', () => {
		const { html } = invitationMessage(invitation);
		expect(html).toContain('text-align:center;">PocketTrail</td>');
		expect(html).toContain('<tr><td align="center" style="padding:32px 24px;text-align:center;">');
		expect(html).toContain('<table role="presentation" align="center"');
		expect(html).toContain('style="margin:0 auto;"');
		expect(html).toContain('padding:20px 24px 0;font-size:12px;line-height:20px;color:#62626b;text-align:center;');
	});

	it('escapes organization, role, mailbox and link data before inserting HTML', () => {
		const message = invitationMessage({
			...invitation,
			organization: '<img src=x onerror="alert(1)"> & Team',
			role: '<script>alert(1)</script>',
			email: "guest'o@example.test",
			acceptUrl: invitation.acceptUrl + '&next=" onclick="alert(1)'
		});
		expect(message.html).toContain('&lt;img');
		expect(message.html).toContain('&amp; Team');
		expect(message.html).toContain('&lt;script&gt;');
		expect(message.html).toContain('guest&#39;o@example.test');
		expect(message.html).toContain('&amp;next=&quot; onclick=&quot;');
		expect(message.html).not.toMatch(/<script|<img|href="[^"]*" onclick=/i);
	});

	it('rejects non-web acceptance links', () => {
		expect(() => invitationMessage({ ...invitation, acceptUrl: 'javascript:alert(1)' })).toThrow('Invalid invitation URL');
	});
});
