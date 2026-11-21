import {error,isRedirect,isHttpError} from '@sveltejs/kit';
import {requireOrg,saveDetails,saveTag,saveAllocations} from './txns';

import {qOne} from './db';
import type {RequestEvent} from '@sveltejs/kit';
import type {Credential} from './mcp';
export async function delegationContext(event:RequestEvent,c:Credential){
 if(!c.userId || !c.grantId || !c.scopes)throw error(403,'OAuth delegation required.');
 // Verified bearer identity becomes guard identity only inside this server call.
 const {newSession,encodeCookie,SESSION_COOKIE}=await import('./session');
 const {appConfig}=await import('./auth');const config=appConfig(event.platform);
 if(!config.secret)throw error(503,'Authentication unavailable.');
 const session=await newSession(config.secret,c.userId,Math.floor(Date.now()/1000));
 const cookie=await encodeCookie(config.secret,session);
 const ctx=await requireOrg({...event,cookies:{get:(name:string)=>name===SESSION_COOKIE?cookie:undefined} as any},c.orgSlug,'ViewTransactions');
 return ctx;
}
export async function mcpWrite(event:RequestEvent,c:Credential,name:string,args:Record<string,unknown>){
 const scope=name==='set_income_notes'?'income:write':['allocate_transaction','approve_purpose','request_purpose_changes'].includes(name)?'purposes:write':'tags:write';
 if(!c.scopes?.includes(scope))throw error(403,'Delegated scope denied.');
 const reviewing=['approve_purpose','request_purpose_changes'].includes(name);
  const allowed=reviewing?['id','revision','note']:name==='set_income_notes'?['id','revision','notes']:name==='allocate_transaction'?['id','revision','allocations','justification']:['id','revision','tag','remove_tag'];
 if(Object.keys(args).some(k=>!allowed.includes(k)) || !Number.isSafeInteger(args.id) || Number(args.id)<1 || !Number.isSafeInteger(args.revision) || Number(args.revision)<0)throw error(400,'Valid transaction ID and current revision required.');
 const ctx=await delegationContext(event,c);
 if(!ctx.can(reviewing?'ApproveTransactions':'DocumentTransactions'))throw error(403,'Documentation access denied.');
 ctx.delegation={clientId:c.clientId,grantId:c.grantId!,scope,tokenHash:c.tokenHash};
 const form=new FormData();form.set('revision',String(args.revision));
 if(reviewing){if(typeof args.note!=='string')throw error(400,'Review note required (empty allowed for approval).');form.set('note',args.note);
  }else if(name==='allocate_transaction'){
 if(args.justification!==undefined && typeof args.justification!=='string')throw error(400,'Invalid justification.');form.set('justification',String(args.justification ?? ''));
 if(!Array.isArray(args.allocations) || args.allocations.length>100)throw error(400,'Allocations array required. This replaces all allocations.');
 const {rupiahInput}=await import('#lib/fmt.ts');
 for(const row of args.allocations){if(!row || Object.keys(row).some(k=>!['purpose_id','amount_minor','responsible_membership_id'].includes(k)) || !Number.isSafeInteger(row.purpose_id) || row.purpose_id<1 || !Number.isSafeInteger(row.amount_minor) || row.amount_minor<1 || (row.responsible_membership_id!=null && (!Number.isSafeInteger(row.responsible_membership_id)||row.responsible_membership_id<1)))throw error(400,'Invalid allocation.');form.append('alloc_purpose[]',String(row.purpose_id));form.append('alloc_amount[]',rupiahInput(row.amount_minor));form.append('alloc_member[]',row.responsible_membership_id==null?'':String(row.responsible_membership_id));}
 const t=await qOne<{responsible_membership_id:number|null}>(ctx.db,'SELECT responsible_membership_id FROM transactions WHERE id=?1 AND org_id=?2',[args.id,ctx.org.id]);if(!t)throw error(404,'Transaction not found.');if(t.responsible_membership_id!==null)form.set('responsible_member_id',String(t.responsible_membership_id));
 }else if(name==='set_income_notes'){
 if(typeof args.notes!=='string')throw error(400,'Income notes required.');
 const t=await qOne<{amount_minor:number}>(ctx.db,'SELECT amount_minor FROM transactions WHERE id=?1 AND org_id=?2',[args.id,ctx.org.id]);
 if(!t)throw error(404,'Transaction not found.');if(t.amount_minor<=0)throw error(400,'Expense documentation belongs to purposes; this tool updates income only.');
 form.set('explanation',args.notes);
 }else{
 if((args.tag===undefined)===(args.remove_tag===undefined))throw error(400,'Supply exactly one tag or remove_tag.');
 if(args.tag!==undefined){if(typeof args.tag!=='string')throw error(400,'Invalid tag.');form.set('tag',args.tag);}
 else {if(!Number.isSafeInteger(args.remove_tag)||Number(args.remove_tag)<1)throw error(400,'Invalid tag ID.');form.set('remove_tag',String(args.remove_tag));}
 }
 try{if(reviewing)await (await import('./purposes')).reviewPurpose(ctx,Number(args.id),form,name==='request_purpose_changes');else if(name==='set_income_notes')await saveDetails(ctx,Number(args.id),form);else if(name==='allocate_transaction')await saveAllocations(ctx,Number(args.id),form);else await saveTag(ctx,Number(args.id),form);}catch(cause){if(!isRedirect(cause)){if(isHttpError(cause))throw cause;throw error(409,'Delegation changed or write failed; reload authorization and transaction before retrying.');}}
 return {actorType:'AI',onBehalfOf:ctx.user.name,...(reviewing?{purposeId:args.id}:{transactionId:args.id}),revision:Number(args.revision)+1};
}
