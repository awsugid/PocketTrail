import {error,isRedirect,isHttpError} from '@sveltejs/kit';
import {requireOrg,saveDetails,saveTag} from './txns';

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
 const scope=name==='set_income_notes'?'income:write':'tags:write';
 if(!c.scopes?.includes(scope))throw error(403,'Delegated scope denied.');
 const allowed=name==='set_income_notes'?['id','revision','notes']:['id','revision','tag','remove_tag'];
 if(Object.keys(args).some(k=>!allowed.includes(k)) || !Number.isSafeInteger(args.id) || Number(args.id)<1 || !Number.isSafeInteger(args.revision) || Number(args.revision)<0)throw error(400,'Valid transaction ID and current revision required.');
 const ctx=await delegationContext(event,c);
 if(!ctx.can('DocumentTransactions'))throw error(403,'Documentation access denied.');
 ctx.delegation={clientId:c.clientId,grantId:c.grantId!,scope,tokenHash:c.tokenHash};
 const form=new FormData();form.set('revision',String(args.revision));
 if(name==='set_income_notes'){
 if(typeof args.notes!=='string')throw error(400,'Income notes required.');
 const t=await qOne<{amount_minor:number}>(ctx.db,'SELECT amount_minor FROM transactions WHERE id=?1 AND org_id=?2',[args.id,ctx.org.id]);
 if(!t)throw error(404,'Transaction not found.');if(t.amount_minor<=0)throw error(400,'Expense documentation belongs to purposes; this tool updates income only.');
 form.set('explanation',args.notes);
 }else{
 if((args.tag===undefined)===(args.remove_tag===undefined))throw error(400,'Supply exactly one tag or remove_tag.');
 if(args.tag!==undefined){if(typeof args.tag!=='string')throw error(400,'Invalid tag.');form.set('tag',args.tag);}
 else {if(!Number.isSafeInteger(args.remove_tag)||Number(args.remove_tag)<1)throw error(400,'Invalid tag ID.');form.set('remove_tag',String(args.remove_tag));}
 }
 try{if(name==='set_income_notes')await saveDetails(ctx,Number(args.id),form);else await saveTag(ctx,Number(args.id),form);}catch(cause){if(!isRedirect(cause)){if(isHttpError(cause))throw cause;throw error(409,'Delegation changed or write failed; reload authorization and transaction before retrying.');}}
 return {actorType:'AI',onBehalfOf:ctx.user.name,transactionId:args.id,revision:Number(args.revision)+1};
}
