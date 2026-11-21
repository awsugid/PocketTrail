import {json} from '@sveltejs/kit';
import {bindings} from '$lib/server/auth';
import {oauthClients,pkce} from '$lib/server/mcp_oauth';
import {encodeToken,hashToken} from '$lib/server/tokens';
import {qOne,nowMs} from '$lib/server/db';
import type {RequestHandler} from '@sveltejs/kit';
export const OPTIONS:RequestHandler=()=>new Response(null,{status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type'}});
export const POST:RequestHandler=async({request,url,platform})=>{
 const env=bindings(platform),form=await request.formData();
 const bad=()=>json({error:'invalid_grant'},{status:400,headers:{'cache-control':'no-store'}});
 const clientId=String(form.get('client_id') ?? ''),client=oauthClients(env.MCP_OAUTH_CLIENTS).find(c=>c.clientId===clientId);
 const verifier=String(form.get('code_verifier') ?? ''),resource=String(form.get('resource') ?? ''),redirect=String(form.get('redirect_uri') ?? ''),code=String(form.get('code') ?? '');
 if(request.headers.get('origin') && !client?.redirectUris.some(u=>new URL(u).origin===request.headers.get('origin')))return bad();
  if(!client || !client.redirectUris.includes(redirect) || resource!==url.origin+'/mcp' || form.get('grant_type')!=='authorization_code' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))return bad();
 const row=await qOne<{grant_id:string;scope:string}>(env.DB,`SELECT c.grant_id,g.scope FROM mcp_codes c JOIN mcp_grants g ON g.id=c.grant_id JOIN memberships m ON m.user_id=g.user_id AND m.org_id=g.org_id WHERE c.code_hash=?1 AND c.challenge=?2 AND c.redirect_uri=?3 AND c.resource=?4 AND c.expires_at>?5 AND c.used_at IS NULL AND g.client_id=?6 AND g.revoked_at IS NULL AND m.removed_at IS NULL AND m.invited=0`,[hashToken(code),pkce(verifier),redirect,resource,nowMs(),clientId]);
 if(!row || row.scope.split(' ').some(s=>!client.scopes.includes(s)))return bad();
 const token=encodeToken(),hash=hashToken(token),now=nowMs();
 const result=await env.DB.batch([
 env.DB.prepare(`UPDATE mcp_codes SET used_at=?1 WHERE code_hash=?2 AND used_at IS NULL AND expires_at>?1`).bind(now,hashToken(code)),
 env.DB.prepare(`INSERT INTO mcp_tokens(token_hash,grant_id,resource,expires_at) SELECT ?1,?2,?3,?4 WHERE changes()=1`).bind(hash,row.grant_id,resource,now+900000),
 env.DB.prepare('SELECT token_hash FROM mcp_tokens WHERE token_hash=?1').bind(hash)
 ]);
 if(!result[2]?.results.length)return bad();
 return json({access_token:token,token_type:'Bearer',expires_in:900,scope:row.scope},{headers:{'cache-control':'no-store','access-control-allow-origin':'*'}});
};
