import type { PageServerLoad } from './$types';

import { requireMember, shellContext } from '$lib/server/auth';
import { settingsPageData } from '$lib/server/settings';

// Settings index: one page per focused section. This route only summarizes and
// links; every mutation lives on its section route and re-checks its own
// permission there.
export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ViewTransactions');
	return {
		shell: await shellContext(ctx),
		settings: await settingsPageData(ctx, event.url)
	};
};
