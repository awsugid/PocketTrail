import type { RequestHandler } from './$types';

import { verifiedForm } from '$lib/server/auth';
import { requirePlatformAdmin, saveTemplate } from '$lib/server/platform';

// POST /platform/role-templates — upsert a named permission bundle that
// organizations can copy as their own role.
export const POST: RequestHandler = async (event) => {
	const login = await requirePlatformAdmin(event);
	const form = await verifiedForm(event, login.session);
	return saveTemplate(event, login, form);
};
