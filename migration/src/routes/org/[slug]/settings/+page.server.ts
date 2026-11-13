import type { Actions, PageServerLoad, RequestEvent } from './$types';

import { requireMember, shellContext } from '$lib/server/auth';
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

/** Settings mutations share one permission-checked context per action. */
async function ctxFor(event: RequestEvent, permission: Parameters<typeof requireMember>[2]): Promise<SettingsCtx> {
	const ctx = await requireMember(event, event.params.slug, permission);
	return {
		db: ctx.db,
		user: ctx.user,
		org: ctx.org,
		memberRows: ctx.memberRows,
		secret: ctx.config.secret
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
		const ctx = await ctxFor(event, 'ManageRoles');
		return saveRole(ctx, await event.request.formData(), null);
	},
	updateRole: async (event) => {
		const ctx = await ctxFor(event, 'ManageRoles');
		const form = await event.request.formData();
		return saveRole(ctx, form, intField(form, 'id'));
	},
	applyTemplate: async (event) => {
		const ctx = await requireMember(event, event.params.slug, 'ManageRoles');
		return applyTemplate(ctx, await event.request.formData());
	},
	addMember: async (event) => {
		const ctx = await ctxFor(event, 'ManageMembers');
		return addMember(ctx, await event.request.formData());
	},
	setRole: async (event) => {
		const ctx = await ctxFor(event, 'ManageMembers');
		const form = await event.request.formData();
		return setRole(ctx, form, intField(form, 'id'));
	},
	removeMember: async (event) => {
		const ctx = await ctxFor(event, 'ManageMembers');
		const form = await event.request.formData();
		return removeMember(ctx, intField(form, 'id'));
	},
	restoreMember: async (event) => {
		const ctx = await ctxFor(event, 'ManageMembers');
		const form = await event.request.formData();
		return restoreMember(ctx, intField(form, 'id'));
	},
	addMapping: async (event) => {
		const ctx = await ctxFor(event, 'ImportStatements');
		return addMapping(ctx, await event.request.formData());
	},
	deleteMapping: async (event) => {
		const ctx = await ctxFor(event, 'ImportStatements');
		const form = await event.request.formData();
		return deleteMapping(ctx, intField(form, 'id'));
	},
	addPocket: async (event) => {
		const ctx = await ctxFor(event, 'ImportStatements');
		return addPocket(ctx, await event.request.formData());
	},
	setPocketOwner: async (event) => {
		const ctx = await ctxFor(event, 'ImportStatements');
		const form = await event.request.formData();
		return setPocketOwner(ctx, form, intField(form, 'id'));
	},
	saveIncomeRole: async (event) => {
		const ctx = await ctxFor(event, 'ManageRoles');
		return saveIncomeRole(ctx, await event.request.formData());
	},
	saveNotifications: async (event) => {
		const ctx = await ctxFor(event, 'ManageNotifications');
		return saveNotifications(ctx, await event.request.formData());
	}
};