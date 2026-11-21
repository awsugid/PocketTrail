import { requireMember, shellContext } from '$lib/server/auth';
import { submittedPurposeTasks } from '$lib/server/purposes';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
 const ctx=await requireMember(event,event.params.slug,'ViewTransactions');
 const me=ctx.memberRows.find(member=>member.user_id===ctx.user.id && member.removed_at===null);
 const review=ctx.can('ApproveTransactions') && me
  ? (await submittedPurposeTasks(ctx.db,ctx.org.id)).filter(task=>!task.excluded.includes(me.id)) : [];
 return {shell:await shellContext(ctx),review};
};
