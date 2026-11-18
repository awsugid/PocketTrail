import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

import { bindings, requireMember, shellContext } from '$lib/server/auth';
import { validDate } from '$lib/fmt';
import { saveNotifications, settingsPageData } from '$lib/server/settings';
import { settingsForm } from '$lib/server/settings_actions';

// Notifications: defaults, the transaction-date cutoff, recipient preview, and
// the outbox (emailed when EMAIL_DELIVERY_ENABLED). Enabling requires a
// preview of the same cutoff.
export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ViewTransactions');
	return {
		shell: await shellContext(ctx),
		emailDeliveryEnabled: bindings(event.platform).EMAIL_DELIVERY_ENABLED === 'true',
		settings: await settingsPageData(ctx, event.url)
	};
};

export const actions: Actions = {
	// One cutoff control feeds both buttons: Preview carries the chosen date to the
	// page URL (so the recipient list and its token are computed for it); Save
	// posts the same field.
	preview: async (event) => {
		const { ctx, form } = await settingsForm(event, 'ManageNotifications', 'notifications');
		const cutoff = form.get('cutoff_date');
		if (typeof cutoff !== 'string' || !validDate(cutoff)) throw error(400, 'Choose a transaction-date cutoff to preview.');
		throw redirect(303, `/org/${ctx.org.slug}/settings/notifications?cutoff_date=${cutoff}`);
	},
	saveNotifications: async (event) => {
		const { ctx, form } = await settingsForm(event, 'ManageNotifications', 'notifications');
		return saveNotifications(ctx, form);
	}
};
