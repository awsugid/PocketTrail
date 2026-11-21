import type { Actions, PageServerLoad } from './$types';

import { requireMember, shellContext, verifiedForm } from '#lib/server/auth.ts';
import { applyTemplate } from '#lib/server/platform.ts';
import { saveRole, saveRoles, settingsPageData } from '#lib/server/settings.ts';
import { settingsForm } from '#lib/server/settings_actions.ts';

// Roles: permission bundles and platform templates copied into this organization.
export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ViewTransactions');
	return {
		shell: await shellContext(ctx),
		settings: await settingsPageData(ctx, event.url)
	};
};

export const actions: Actions = {
	createRole: async (event) => {
		const { ctx, form } = await settingsForm(event, 'ManageRoles', 'roles');
		return saveRole(ctx, form);
	},
	saveRoles: async (event) => {
		const { ctx, form } = await settingsForm(event, 'ManageRoles', 'roles');
		return saveRoles(ctx, form);
	},
	applyTemplate: async (event) => {
		const ctx = await requireMember(event, event.params.slug, 'ManageRoles');
		const form = await verifiedForm(event, ctx.session);
		return applyTemplate(ctx, form);
	}
};
