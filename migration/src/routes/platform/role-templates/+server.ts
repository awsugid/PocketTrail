import type { RequestHandler } from './$types';

import { requirePlatformAdmin, saveTemplate } from '$lib/server/platform';

// POST /platform/role-templates — upsert a named permission bundle that
// organizations can copy as their own role.
export const POST: RequestHandler = async (event) => {
	const login = await requirePlatformAdmin(event);
	const form = await event.request.formData();
	return saveTemplate(event, login, form);
};