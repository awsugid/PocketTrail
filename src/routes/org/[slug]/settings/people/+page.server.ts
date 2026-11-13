import type { Actions, PageServerLoad } from './$types';

import { requireMember, shellContext } from '$lib/server/auth';
import { addMember, removeMember, restoreMember, setRole, settingsPageData } from '$lib/server/settings';
import { intField, settingsForm } from '$lib/server/settings_actions';

// People: memberships, roles and pending invitations. Invitation forms post to
// their own endpoints (/settings/invitations…), which re-check ManageMembers.
export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ViewTransactions');
	return {
		shell: await shellContext(ctx),
		settings: await settingsPageData(ctx, event.url)
	};
};

export const actions: Actions = {
	addMember: async (event) => {
		const { ctx, form } = await settingsForm(event, 'ManageMembers', 'people');
		return addMember(ctx, form);
	},
	setRole: async (event) => {
		const { ctx, form } = await settingsForm(event, 'ManageMembers', 'people');
		return setRole(ctx, form, intField(form, 'id'));
	},
	removeMember: async (event) => {
		const { ctx, form } = await settingsForm(event, 'ManageMembers', 'people');
		return removeMember(ctx, intField(form, 'id'));
	},
	restoreMember: async (event) => {
		const { ctx, form } = await settingsForm(event, 'ManageMembers', 'people');
		return restoreMember(ctx, intField(form, 'id'));
	}
};
