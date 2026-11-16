import type { Actions, PageServerLoad } from './$types';

import { bindings, requireMember, shellContext } from '$lib/server/auth';
import { removeMember, restoreMember, setRole, settingsPageData } from '$lib/server/settings';
import { addPerson } from '$lib/server/people';
import { intField, settingsForm } from '$lib/server/settings_actions';

// People: one add action selects immediate membership or a pending invitation.
// Every action re-checks ManageMembers before reading the form.
export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ViewTransactions');
	return {
		shell: await shellContext(ctx),
		invitationDeliveryEnabled: bindings(event.platform).EMAIL_DELIVERY_ENABLED === 'true',
		settings: await settingsPageData(ctx, event.url)
	};
};

export const actions: Actions = {
	addMember: async (event) => {
		const { ctx, form } = await settingsForm(event, 'ManageMembers', 'people');
		return addPerson(ctx, form, bindings(event.platform), event.url.origin);
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
