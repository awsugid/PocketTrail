import type { Actions, PageServerLoad } from './$types';

import { requireMember, shellContext } from '$lib/server/auth';
import { addMapping, deleteMapping, saveIncomeRole, settingsPageData } from '$lib/server/settings';
import { intField, settingsForm } from '$lib/server/settings_actions';

// Routing: statement-label mappings and the income explanation role. Mapping
// changes never rewrite existing assignments.
export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ViewTransactions');
	return {
		shell: await shellContext(ctx),
		settings: await settingsPageData(ctx, event.url)
	};
};

export const actions: Actions = {
	addMapping: async (event) => {
		const { ctx, form } = await settingsForm(event, 'ImportStatements', 'routing');
		return addMapping(ctx, form);
	},
	deleteMapping: async (event) => {
		const { ctx, form } = await settingsForm(event, 'ImportStatements', 'routing');
		return deleteMapping(ctx, intField(form, 'id'));
	},
	saveIncomeRole: async (event) => {
		const { ctx, form } = await settingsForm(event, 'ManageRoles', 'routing');
		return saveIncomeRole(ctx, form);
	}
};
