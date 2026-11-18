// One entry point for adding people: existing accounts receive membership,
// unknown emails receive an invitation without a previous sign-in requirement.
import { error } from '@sveltejs/kit';
import { qOne } from './db';
import { createInvitation, inviteCtxFrom } from './invitations';
import type { MailEnv } from './invitation_mail';
import { validEmail } from './profile';
import { addMember, type SettingsCtx } from './settings';
import { isPlaceholderUser } from './rows';

export async function addPerson(
	ctx: SettingsCtx,
	form: FormData,
	env: MailEnv,
	baseUrl: string
): Promise<never> {
	const email = String(form.get('email') ?? '').trim().toLowerCase();
	if (!validEmail(email)) throw error(400, 'Enter a valid email address.');
	const user = await qOne<{ id: string; google_sub: string | null }>(
		ctx.db,
		'SELECT id, google_sub FROM users WHERE email=?1 COLLATE NOCASE',
		[email]
	);
	// A placeholder (invitee who never signed in) is re-invited, not granted.
	if (user && !isPlaceholderUser(user)) {
		form.set('user_id', user.id);
		return addMember(ctx, form);
	}
	form.set('email', email);
	return createInvitation(
		inviteCtxFrom(ctx, `/org/${ctx.org.slug}/settings/invitations`),
		form,
		env,
		baseUrl
	);
}
