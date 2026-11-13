import type { Actions, PageServerLoad, RequestEvent } from './$types';

import { requireMember, shellContext, verifiedForm } from '$lib/server/auth';
import {
	addMapping,
	addMember,
	addPocket,
	deleteMapping,
	removeMember,
	restoreMember,
	saveIncomeRole,
	saveNotifications,
	saveRole,
	sendDigest,
	setPocketOwner,
	setRole,
	settingsPageData,
	type SettingsCtx
} from '$lib/server/settings';
import { applyTemplate } from '$lib/server/platform';

// Organization settings: one page, many focused sections. Every action
// re-checks its own permission inside the mutation it performs. Section
// visibility is presentation only — hiding a form is never the gate.

export const load: PageServerLoad = async (event) => {
	const ctx = await requireMember(event, event.params.slug, 'ViewTransactions');
	return {
		shell: await shellContext(ctx),
		settings: await settingsPageData(ctx, event.url)
	};
};

/** Settings mutations share one permission-checked context per action, and the
 * form is only read after the origin and session-CSRF gates pass. */
async function formFor(
	event: RequestEvent,
	permission: Parameters<typeof requireMember>[2]
): Promise<{ ctx: SettingsCtx; form: FormData }> {
	const member = await requireMember(event, event.params.slug, permission);
	const form = await verifiedForm(event, member.session);
	return {
		ctx: {
			db: member.db,
			user: member.user,
			org: member.org,
			memberRows: member.memberRows,
			secret: member.config.secret
		},
		form
	};
}

/** Row ids arrive as form fields (page actions have no sub-path params). */
function intField(form: FormData, name: string): number {
	const raw = form.get(name);
	const value = typeof raw === 'string' ? Number(raw) : NaN;
	return Number.isSafeInteger(value) && /^[0-9]{1,15}$/.test(raw as string) ? value : 0;
}

export const actions: Actions = {
	createRole: async (event) => {
		const { ctx, form } = await formFor(event, 'ManageRoles');
		return saveRole(ctx, form, null);
	},
	updateRole: async (event) => {
		const { ctx, form } = await formFor(event, 'ManageRoles');
		return saveRole(ctx, form, intField(form, 'id'));
	},
	applyTemplate: async (event) => {
		const member = await requireMember(event, event.params.slug, 'ManageRoles');
		const form = await verifiedForm(event, member.session);
		return applyTemplate(member, form);
	},
	addMember: async (event) => {
		const { ctx, form } = await formFor(event, 'ManageMembers');
		return addMember(ctx, form);
	},
	setRole: async (event) => {
		const { ctx, form } = await formFor(event, 'ManageMembers');
		return setRole(ctx, form, intField(form, 'id'));
	},
	removeMember: async (event) => {
		const { ctx, form } = await formFor(event, 'ManageMembers');
		return removeMember(ctx, intField(form, 'id'));
	},
	restoreMember: async (event) => {
		const { ctx, form } = await formFor(event, 'ManageMembers');
		return restoreMember(ctx, intField(form, 'id'));
	},
	addMapping: async (event) => {
		const { ctx, form } = await formFor(event, 'ImportStatements');
		return addMapping(ctx, form);
	},
	deleteMapping: async (event) => {
		const { ctx, form } = await formFor(event, 'ImportStatements');
		return deleteMapping(ctx, intField(form, 'id'));
	},
	addPocket: async (event) => {
		const { ctx, form } = await formFor(event, 'ImportStatements');
		return addPocket(ctx, form);
	},
	setPocketOwner: async (event) => {
		const { ctx, form } = await formFor(event, 'ImportStatements');
		return setPocketOwner(ctx, form, intField(form, 'id'));
	},
	saveIncomeRole: async (event) => {
		const { ctx, form } = await formFor(event, 'ManageRoles');
		return saveIncomeRole(ctx, form);
	},
	saveNotifications: async (event) => {
		const { ctx, form } = await formFor(event, 'ManageNotifications');
		return saveNotifications(ctx, form);
	}
};