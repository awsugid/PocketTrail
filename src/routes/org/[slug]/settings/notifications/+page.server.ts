import type { Actions, PageServerLoad } from './$types';

import { requireMember, shellContext } from '$lib/server/auth';
import { saveNotifications, settingsPageData } from '$lib/server/settings';
import { settingsForm } from '$lib/server/settings_actions';

// Notifications: defaults, the transaction-date cutoff, recipient preview, and
// the local outbox. Enabling requires a preview of the same cutoff.
export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ViewTransactions');
	return {
		shell: await shellContext(ctx),
		settings: await settingsPageData(ctx, event.url)
	};
};

export const actions: Actions = {
	saveNotifications: async (event) => {
		const { ctx, form } = await settingsForm(event, 'ManageNotifications', 'notifications');
		return saveNotifications(ctx, form);
	}
};
