import type { SmtpMessage } from './smtp';

export interface InvitationEmail {
	email: string;
	organization: string;
	role: string;
	expiresAt: number;
	acceptUrl: string;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
	})[character]!);
}

/** Self-contained email: inline styles and presentation tables for mail clients,
 * no remote images/fonts/tracking, with an equivalent plain-text alternative. */
export function invitationMessage(invitation: InvitationEmail): SmtpMessage {
	const { email, organization, role, expiresAt, acceptUrl } = invitation;
	if (!['https:', 'http:'].includes(new URL(acceptUrl).protocol)) {
		throw new Error('Invalid invitation URL.');
	}
	// Invitees may not have an account yet, and no recipient timezone is stored.
	// Use the agreed Jakarta fallback, never the sender's or server's timezone.
	const expires = new Intl.DateTimeFormat('en-GB', {
		day: 'numeric', month: 'short', year: 'numeric',
		hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta'
	}).format(expiresAt) + ' WIB (UTC+07:00)';
	const orgHtml = escapeHtml(organization);
	const roleHtml = escapeHtml(role);
	const emailHtml = escapeHtml(email);
	const urlHtml = escapeHtml(acceptUrl);
	const expiresHtml = escapeHtml(expires);
	return {
		to: email,
		subject: `Join ${organization} on PocketTrail`,
		body: `You're invited to join ${organization} on PocketTrail as ${role}.\n\nAccept invitation:\n${acceptUrl}\n\nSign in with the Google account for ${email}.\nThis single-use invitation expires ${expires}.\n\nIf you weren't expecting this invitation, you can safely ignore it.\nFinancial details stay in PocketTrail; this email carries none.\n`,
		html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PocketTrail invitation</title>
</head>
<body style="margin:0;padding:0;background-color:#fafafa;color:#18181b;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your invitation to ${orgHtml}. Accept to join as ${roleHtml}.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#fafafa;table-layout:fixed;">
<tr><td align="center" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;table-layout:fixed;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:12px;">
<tr><td align="center" style="padding:24px;border-bottom:1px solid #e4e4e7;font-size:18px;line-height:24px;font-weight:700;color:#27272a;text-align:center;">PocketTrail</td></tr>
<tr><td align="center" style="padding:32px 24px;text-align:center;">
<h1 style="margin:0 0 16px;font-size:30px;line-height:38px;font-weight:700;letter-spacing:-0.6px;color:#18181b;">You're invited.</h1>
<p style="margin:0 0 28px;font-size:16px;line-height:26px;color:#62626b;">Join <strong style="color:#18181b;overflow-wrap:anywhere;">${orgHtml}</strong> on PocketTrail as <strong style="color:#18181b;overflow-wrap:anywhere;">${roleHtml}</strong>.</p>
<p style="margin:0 0 4px;font-size:14px;line-height:22px;color:#62626b;">Sign in with your Google account</p>
<p style="margin:0 0 24px;font-size:16px;line-height:24px;font-weight:700;color:#18181b;word-break:break-all;">${emailHtml}</p>
<table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
<tr><td align="center" bgcolor="#27272a" style="border-radius:6px;mso-padding-alt:14px 24px;">
<a href="${urlHtml}" style="display:inline-block;padding:14px 24px;border:1px solid #27272a;border-radius:6px;font-size:16px;line-height:22px;font-weight:700;color:#ffffff;text-decoration:none;">Accept invitation</a>
</td></tr>
</table>
<p style="margin:20px 0 0;font-size:13px;line-height:21px;color:#62626b;">This invitation works once and expires<br><strong style="color:#18181b;">${expiresHtml}</strong>.</p>
</td></tr>
<tr><td align="center" style="padding:24px;border-top:1px solid #e4e4e7;text-align:center;">
<p style="margin:0 0 8px;font-size:13px;line-height:21px;color:#62626b;">Button not working? Copy this link into your browser:</p>
<p style="margin:0;font-size:12px;line-height:20px;word-break:break-all;overflow-wrap:anywhere;"><a href="${urlHtml}" style="color:#9a4614;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${urlHtml}</a></p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;table-layout:fixed;">
<tr><td align="center" style="padding:20px 24px 0;font-size:12px;line-height:20px;color:#62626b;text-align:center;">
<p style="margin:0 0 8px;">If you weren't expecting this invitation, you can safely ignore it.</p>
<p style="margin:0;">Financial details stay in PocketTrail. This email carries none.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
	};
}
