import { redirect } from '@sveltejs/kit';
import { requireLogin,orgsOfUser,verifiedForm } from '$lib/server/auth';
import { authorizationRequest,issueCode } from '$lib/server/mcp_oauth';
import type { PageServerLoad,Actions } from './$types';
export const load:PageServerLoad=async(event)=>{
 const request=authorizationRequest(event);
 event.cookies.set('pt_oauth_return',event.url.pathname+event.url.search,{path:'/',httpOnly:true,sameSite:'lax',secure:event.url.protocol==='https:',maxAge:300});
 const login=await requireLogin(event);
 return {clientName:request.client.name,clientId:request.client.clientId,callback:request.redirectUri,callbackOrigin:new URL(request.redirectUri).origin,scopes:request.scopes,organizations:await orgsOfUser(login.db,login.user.id),csrf:login.session.csrf,userName:login.user.name};
};
export const actions:Actions={default:async(event)=>{
 const login=await requireLogin(event),form=await verifiedForm(event,login.session);
 if(form.get('decision')!=='allow'){const r=authorizationRequest(event),url=new URL(r.redirectUri);url.searchParams.set('error','access_denied');url.searchParams.set('state',r.state);redirect(303,url.href);}
 redirect(303,await issueCode(event,String(form.get('org_slug') ?? '')));
}};
