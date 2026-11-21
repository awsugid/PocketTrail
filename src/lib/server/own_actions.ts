import { error } from '@sveltejs/kit';
import type { TenantContext } from './auth';
import { nowMs, qAll, qOne } from './db';

export function ownMembership(ctx: TenantContext): number {
 const member=ctx.memberRows.find(m=>m.user_id===ctx.user.id && m.removed_at===null && !m.invited);
 if (!member) throw error(403,'Active organization membership required.');
 return member.id;
}
export const OWN_ASSIGNMENT = `((t.responsible_membership_id=?2 AND NOT EXISTS(SELECT 1 FROM allocations ax WHERE ax.transaction_id=t.id AND ax.org_id=t.org_id)) OR EXISTS(
 SELECT 1 FROM allocations a JOIN purposes p ON p.id=a.purpose_id AND p.org_id=a.org_id
 WHERE a.transaction_id=t.id AND a.org_id=t.org_id AND p.suppressed=0 AND
 (a.responsible_membership_id=?2 OR (a.responsible_membership_id IS NULL AND
 (EXISTS(SELECT 1 FROM purpose_responsibles pr WHERE pr.purpose_id=p.id AND pr.membership_id=?2) OR
 (NOT EXISTS(SELECT 1 FROM purpose_responsibles pr WHERE pr.purpose_id=p.id) AND t.responsible_membership_id=?2))))))`;
const OPEN = `t.suppressed=0 AND t.amount_minor<0 AND t.status!='approved' AND ${OWN_ASSIGNMENT}`;
const ASSIGNMENT_KEY = `(CAST(t.revision AS TEXT)||':'||CAST(t.action_assignment_generation AS TEXT))`;
const UNANSWERED = `NOT EXISTS(SELECT 1 FROM action_responses r WHERE r.org_id=t.org_id AND r.transaction_id=t.id AND r.membership_id=?2 AND r.assignment_key=${ASSIGNMENT_KEY})`;
export interface OwnTask { id:number; txn_date:string; counterparty:string; explanation:string; revision:string }
export async function ownActions(ctx:TenantContext):Promise<OwnTask[]> {
 return qAll<OwnTask>(ctx.db,`SELECT t.id,t.txn_date,t.counterparty,'' AS explanation,${ASSIGNMENT_KEY} AS revision FROM transactions t WHERE t.org_id=?1 AND ${OPEN} AND ${UNANSWERED} ORDER BY t.txn_date,t.id`,[ctx.org.id,ownMembership(ctx)]);
}
export async function ownAction(ctx:TenantContext,id:number):Promise<OwnTask> {
 const task=await qOne<OwnTask>(ctx.db,`SELECT t.id,t.txn_date,t.counterparty,'' AS explanation,${ASSIGNMENT_KEY} AS revision FROM transactions t WHERE t.org_id=?1 AND t.id=?3 AND ${OPEN}`,[ctx.org.id,ownMembership(ctx),id]);
 if (!task) throw error(404,'Assigned Action not found.');
 return task;
}
export async function explainOwnAction(ctx:TenantContext,id:number,form:FormData):Promise<void> {
 const text=form.get('explanation'), raw=form.get('revision');
 const revision=typeof raw==='string' && /^\d+:\d+$/.test(raw) ? raw : null;
 if(typeof text!=='string' || !text.trim() || new TextEncoder().encode(text).length>10000 || revision===null) throw error(400,'Explanation required (maximum 10000 bytes), with current revision.');
 await ownAction(ctx,id);
 const token=crypto.randomUUID(),now=nowMs(),member=ownMembership(ctx);
 // One response per member and assignment revision. Shared finance rows never change.
 const results=await ctx.db.batch([
 ctx.db.prepare(`INSERT OR IGNORE INTO action_responses(org_id,transaction_id,membership_id,explanation,assignment_key,created_at,mutation_token)
 SELECT t.org_id,t.id,?2,?4,${ASSIGNMENT_KEY},?5,?6 FROM transactions t WHERE t.org_id=?1 AND t.id=?3 AND ${ASSIGNMENT_KEY}=?7 AND ${OPEN}`).bind(ctx.org.id,member,id,text.trim(),now,token,revision),
 ctx.db.prepare(`INSERT INTO transaction_audit(transaction_id,org_id,actor_membership_id,action,previous_status,new_status,details,created_at)
 SELECT t.id,t.org_id,?2,'action.explained',t.status,t.status,?4,?5 FROM transactions t JOIN action_responses r ON r.transaction_id=t.id AND r.org_id=t.org_id WHERE t.org_id=?1 AND t.id=?3 AND r.mutation_token=?6`).bind(ctx.org.id,member,id,JSON.stringify({membershipId:member,assignmentRevision:revision,explanation:text.trim()}),now,token),
 ctx.db.prepare(`INSERT INTO audit_events(actor_id,org_id,action,target,outcome,created_at) SELECT ?1,?2,'action.explained',?3,'committed',?4 FROM action_responses WHERE mutation_token=?5`).bind(ctx.user.id,ctx.org.id,`/org/${ctx.org.slug}/actions/${id}/responses/${member}/${revision}`,now,token),
 ctx.db.prepare('SELECT mutation_token FROM action_responses WHERE mutation_token=?1').bind(token)
 ]);
 if(!results[3]?.results.length) throw error(409,'Action changed or already answered; reload before saving.');
}
