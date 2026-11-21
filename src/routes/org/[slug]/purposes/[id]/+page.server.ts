import { requireOrg, actionForm, numericPathId, txnShell } from '$lib/server/txns';
import {
	purposeDetail,
	postPurposeMessage,
	reviewPurpose,
	savePurposeNotes,
	setPurposeResponsibles,
	uploadPurposeEvidence
} from '$lib/server/purposes';
import { error, fail, redirect } from '@sveltejs/kit';
import { qOne, nowMs } from '$lib/server/db';
import { committedIfChanged } from '$lib/server/audit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const ctx = await requireOrg(event, event.params.slug, 'ViewTransactions');
	const purpose = await purposeDetail(ctx, numericPathId(event.params.id));
	return {
		shell: await txnShell(ctx),
		purpose,
		historicalAdmin: ctx.can('ManageRoles') && ctx.can('ApproveTransactions'),
		exemption: await qOne<{id:number;source_reference:string;reason:string}>(ctx.db,'SELECT id,source_reference,reason FROM historical_approval_exemptions WHERE org_id=?1 AND purpose_id=?2 AND revoked_at IS NULL',[ctx.org.id,numericPathId(event.params.id)]),
		msg: event.url.searchParams.get('msg')
	};
};

export const actions: Actions = {
	exempt: async (event) => {
		const ctx=await requireOrg(event,event.params.slug,'ManageRoles');
		if(!ctx.can('ApproveTransactions') || !ctx.can('ViewTransactions')) throw error(403,'Administrator and approval access required.');
		const form=await actionForm(event,ctx.session), id=numericPathId(event.params.id);
		const purpose=await qOne<{revision:number}>(ctx.db,'SELECT revision FROM purposes WHERE id=?1 AND org_id=?2',[id,ctx.org.id]);
		if(!purpose) throw error(404,'Purpose not found.');
		const source=form.get('source_reference'),reason=form.get('reason');
		if(typeof source!=='string' || !source.trim() || source.length>2000 || typeof reason!=='string' || !reason.trim() || reason.length>2000 || form.get('confirmed')!=='yes') return fail(400,{historicalError:'Add the exact Sheet reference and reason, then confirm you verified the mapping.',source:typeof source==='string'?source:'',reason:typeof reason==='string'?reason:''});
		if(String(purpose.revision)!==form.get('revision')) return fail(409,{historicalError:'This purpose changed. Reload and verify its source before trying again.',source,reason});
		const results=await ctx.db.batch([
			ctx.db.prepare(`INSERT INTO historical_approval_exemptions(org_id,purpose_id,source_reference,reason,actor_id,created_at) SELECT ?1,id,?3,?4,?5,?6 FROM purposes WHERE id=?2 AND org_id=?1 AND revision=?7 AND NOT EXISTS(SELECT 1 FROM historical_approval_exemptions WHERE org_id=?1 AND purpose_id=?2 AND revoked_at IS NULL)`).bind(ctx.org.id,id,source.trim(),reason.trim(),ctx.user.id,nowMs(),purpose.revision),
			committedIfChanged(ctx.db,ctx.org.id,ctx.user.id,'approval.historical_exemption',event.url.pathname)
		]);
		if(!results[0]?.meta?.changes) return fail(409,{historicalError:'Purpose changed or already marked historical. Reload to see its current status.',source,reason});
		redirect(303,`${event.url.pathname}?msg=Historical+exemption+recorded`);
	},
	revokeExemption: async (event) => {
		const ctx=await requireOrg(event,event.params.slug,'ManageRoles');
		if(!ctx.can('ApproveTransactions') || !ctx.can('ViewTransactions')) throw error(403,'Administrator and approval access required.');
		await actionForm(event,ctx.session);
		const id=numericPathId(event.params.id);
		const exemption=await qOne<{id:number}>(ctx.db,'SELECT id FROM historical_approval_exemptions WHERE org_id=?1 AND purpose_id=?2 AND revoked_at IS NULL',[ctx.org.id,id]);
		if(!exemption) throw error(404,'Historical exemption not found.');
		await ctx.db.batch([
			ctx.db.prepare('UPDATE historical_approval_exemptions SET revoked_at=?1,revoked_by=?2 WHERE id=?3 AND org_id=?4 AND purpose_id=?5 AND revoked_at IS NULL').bind(nowMs(),ctx.user.id,exemption.id,ctx.org.id,id),
			committedIfChanged(ctx.db,ctx.org.id,ctx.user.id,'approval.exemption_revoked',`${event.url.pathname}/exemptions/${exemption.id}`)
		]);
		redirect(303,`${event.url.pathname}?msg=Historical+exemption+removed`);
	},
	notes: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return savePurposeNotes(ctx, numericPathId(event.params.id), form);
	},
	evidence: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return uploadPurposeEvidence(ctx, numericPathId(event.params.id), form);
	},
	message: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return postPurposeMessage(ctx, numericPathId(event.params.id), form);
	},
	responsibles: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return setPurposeResponsibles(ctx, numericPathId(event.params.id), form);
	},
	approve: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return reviewPurpose(ctx, numericPathId(event.params.id), form, false);
	},
	requestChanges: async (event) => {
		const ctx = await requireOrg(event, event.params.slug);
		const form = await actionForm(event, ctx.session);
		return reviewPurpose(ctx, numericPathId(event.params.id), form, true);
	}
};
