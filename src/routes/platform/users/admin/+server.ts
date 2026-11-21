import type { RequestHandler } from './$types';

import { verifiedForm } from '#lib/server/auth.ts';
import { requirePlatformAdmin, setAdmin } from '#lib/server/platform.ts';

// POST /platform/users/admin — grant or revoke platform administration with
// the actor/count guards and the in-batch outcome probe.
export const POST: RequestHandler = async (event) => {
	const login = await requirePlatformAdmin(event);
	const form = await verifiedForm(event, login.session);
	return setAdmin(event, login, form);
};
