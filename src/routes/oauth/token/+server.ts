import {json} from '@sveltejs/kit';
import {bindings} from '$lib/server/auth';
import {resolveOAuthClient,redirectMatches,pkce} from '$lib/server/mcp_oauth';
import {encodeToken,hashToken} from '$lib/server/tokens';
import {qOne,nowMs} from '$lib/server/db';
import type {RequestHandler} from '@sveltejs/kit';
const headers={'cache-control':'no-store','access-control-allow-origin':'*'};
export const OPTIONS:RequestHandler=()=>new Response(null,{status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type'}});
export const POST:RequestHandler=async({request,url,platform})=>{
 const bad=()=>json({error:'invalid_grant'},{status:400,headers});
 if(url.protocol!=='https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname))return bad();
 const env=bindings(platform);let form:FormData;try{form=await request.formData();}catch{return bad();}
 for(const key of ['client_id','grant_type','resource','code','redirect_uri','code_verifier','refresh_token','scope'])if(form.getAll(key).length>1)return bad();
 const clientId=String(form.get('client_id') ?? ''),client=await resolveOAuthClient(clientId,env.MCP_OAUTH_CLIENTS);
 if(!client)return bad();
 const origin=request.headers.get('origin');
 if(origin && !client.redirectUris.some(uri=>{try{return redirectMatches(uri,origin+new URL(uri).pathname+new URL(uri).search);}catch{return false;}}))return bad();
 const resource=String(form.get('resource') ?? url.origin+'/mcp'),now=nowMs();
 if(resource!==url.origin+'/mcp')return bad();
 const refreshing=form.get('grant_type')==='refresh_token';
 if(!refreshing && form.get('grant_type')!=='authorization_code')return json({error:'unsupported_grant_type'},{status:400,headers});
 const raw=String(form.get(refreshing?'refresh_token':'code') ?? '');if(!/^[A-Za-z0-9_-]{43}$/.test(raw))return bad();
 const digest=hashToken(raw);
 type Grant={grant_id:string;scope:string;created_at:number;used_at:number|null;expires_at:number;revoked_at:number|null};
 const row=await qOne<Grant>(env.DB,`SELECT c.grant_id,g.scope,g.created_at,c.used_at,c.expires_at,g.revoked_at FROM ${refreshing?'mcp_refresh_tokens':'mcp_codes'} c JOIN mcp_grants g ON g.id=c.grant_id JOIN memberships m ON m.user_id=g.user_id AND m.org_id=g.org_id WHERE c.${refreshing?'token_hash':'code_hash'}=?1 AND c.resource=?2 AND g.client_id=?3 AND m.removed_at IS NULL AND m.invited=0`,[digest,resource,clientId]);
 if(!row)return bad();
 if(refreshing && row.used_at!==null){await env.DB.prepare('UPDATE mcp_grants SET revoked_at=COALESCE(revoked_at,?1) WHERE id=?2').bind(now,row.grant_id).run();return bad();}
 if(row.revoked_at!==null || row.used_at!==null || row.expires_at<=now || row.created_at+90*86400000<=now || row.scope.split(' ').some(s=>!client.scopes.includes(s)))return bad();
 if(form.has('scope') && String(form.get('scope')).split(' ').sort().join(' ')!==row.scope.split(' ').sort().join(' '))return bad();
 if(!refreshing){
 const verifier=String(form.get('code_verifier') ?? ''),redirect=String(form.get('redirect_uri') ?? '');
 if(!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))return bad();
 const code=await qOne(env.DB,'SELECT code_hash FROM mcp_codes WHERE code_hash=?1 AND challenge=?2 AND redirect_uri=?3',[digest,pkce(verifier),redirect]);if(!code)return bad();
 }
 const access=encodeToken(),refresh=encodeToken(),accessHash=hashToken(access),refreshHash=hashToken(refresh);
 const result=await env.DB.batch([
 env.DB.prepare(`UPDATE ${refreshing?'mcp_refresh_tokens':'mcp_codes'} SET used_at=?1 WHERE ${refreshing?'token_hash':'code_hash'}=?2 AND used_at IS NULL AND expires_at>?1 AND EXISTS(SELECT 1 FROM mcp_grants WHERE id=grant_id AND revoked_at IS NULL)`).bind(now,digest),
 env.DB.prepare('INSERT INTO mcp_refresh_tokens(token_hash,grant_id,resource,expires_at) SELECT ?1,?2,?3,?4 WHERE changes()=1').bind(refreshHash,row.grant_id,resource,Math.min(now+30*86400000,row.created_at+90*86400000)),
 env.DB.prepare('INSERT INTO mcp_tokens(token_hash,grant_id,resource,expires_at) SELECT ?1,?2,?3,?4 WHERE changes()=1').bind(accessHash,row.grant_id,resource,now+900000),
 env.DB.prepare('SELECT token_hash FROM mcp_tokens WHERE token_hash=?1').bind(accessHash)
 ]);
 if(!result[3]?.results.length){if(refreshing)await env.DB.prepare('UPDATE mcp_grants SET revoked_at=COALESCE(revoked_at,?1) WHERE id=?2').bind(now,row.grant_id).run();return bad();}
 return json({access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:900,scope:row.scope},{headers});
};
