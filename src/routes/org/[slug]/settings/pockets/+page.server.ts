import type { Actions, PageServerLoad } from './$types';

import { requireMember, shellContext } from '$lib/server/auth';
import { addPocket, setPocketOwner, settingsPageData } from '$lib/server/settings';
import { intField, settingsForm } from '$lib/server/settings_actions';

// Pockets: names, opening balances and the active owner each pocket requires.
export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ViewTransactions');
	return {
		shell: await shellContext(ctx),
		settings: await settingsPageData(ctx, event.url)
	};
};

export const actions: Actions = {
	addPocket: async (event) => {
		const { ctx, form } = await settingsForm(event, 'ImportStatements', 'pockets');
		return addPocket(ctx, form);
	},
	setPocketOwner: async (event) => {
		const { ctx, form } = await settingsForm(event, 'ImportStatements', 'pockets');
		return setPocketOwner(ctx, form, intField(form, 'id'));
	}
};
