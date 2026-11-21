import { error } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import { bindings, requireMember, type CtxEvent } from './auth';
import { hashToken, encodeToken } from './tokens';
import { qOne, nowMs } from './db';
export const MCP_SCOPES=['finance:read','income:write','tags:write'] as const;
export interface OAuthClient {clientId:string;name:string;redirectUris:string[];scopes:string[]}
export function oauthClients(config:string|undefined):OAuthClient[]{
 // Private administrator trust config: all callbacks under one client ID must
  // belong to that client's trusted operator. Multiple exact callbacks are valid.
  try { const v=JSON.parse(config ?? '[]');return Array.isArray(v)?v.filter(c=>c && typeof c.clientId==='string' && c.clientId.length>0 && typeof c.name==='string' && c.name.length>0 && Array.isArray(c.redirectUris) && c.redirectUris.length>0 && c.redirectUris.every((u:unknown)=>typeof u==='string' && validRedirect(u)) && Array.isArray(c.scopes) && c.scopes.every((s:string)=>MCP_SCOPES.includes(s as any))):[];}catch{return [];}
}
function validRedirect(raw:string){try{const u=new URL(raw);return !u.hash && !u.username && !u.password && (u.protocol==='https:' || (u.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(u.hostname)));}catch{return false;}}
export function authorizationRequest(event:CtxEvent){
 const p=event.url.searchParams,client=oauthClients(bindings(event.platform).MCP_OAUTH_CLIENTS).find(c=>c.clientId===p.get('client_id'));
 const redirectUri=p.get('redirect_uri') ?? '',resource=p.get('resource') ?? '',challenge=p.get('code_challenge') ?? '',state=p.get('state') ?? '';
 const scopes=(p.get('scope') ?? 'finance:read').split(' ').filter(Boolean);
 if(!client || !client.redirectUris.includes(redirectUri) || p.get('response_type')!=='code' || p.get('code_challenge_method')!=='S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || state.length<16 || state.length>2048 || resource!==event.url.origin+'/mcp' || !scopes.length || scopes.some(s=>!client.scopes.includes(s))) throw error(400,'Invalid OAuth client, redirect URI, resource, scope, state or PKCE challenge.');
 if(event.url.protocol!=='https:' && !['localhost','127.0.0.1'].includes(event.url.hostname))throw error(403,'HTTPS required.');
  return {client,redirectUri,resource,challenge,state,scopes:[...new Set(scopes)].sort()};
}
export async function issueCode(event:CtxEvent,slug:string){
 const request=authorizationRequest(event),ctx=await requireMember(event,slug,'ViewTransactions');
 if(request.scopes.some(s=>s!=='finance:read') && !ctx.can('DocumentTransactions')) throw error(403,'Documentation permission required for write delegation.');
 const code=encodeToken(),grant=crypto.randomUUID(),now=nowMs();
 await ctx.db.batch([
 // Reconnecting replaces only this user's same-client/org/scope delegation.
 ctx.db.prepare('UPDATE mcp_grants SET revoked_at=?1 WHERE user_id=?2 AND org_id=?3 AND client_id=?4 AND scope=?5 AND revoked_at IS NULL').bind(now,ctx.user.id,ctx.org.id,request.client.clientId,request.scopes.join(' ')),
 ctx.db.prepare('INSERT INTO mcp_grants(id,user_id,org_id,client_id,scope,scope_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)').bind(grant,ctx.user.id,ctx.org.id,request.client.clientId,request.scopes.join(' '),JSON.stringify(request.scopes),now),
 ctx.db.prepare('INSERT INTO mcp_codes(code_hash,grant_id,redirect_uri,challenge,resource,expires_at) VALUES(?1,?2,?3,?4,?5,?6)').bind(hashToken(code),grant,request.redirectUri,request.challenge,request.resource,now+120000)
 ]);
 const callback=new URL(request.redirectUri);callback.searchParams.set('code',code);callback.searchParams.set('state',request.state);return callback.href;
}
export function pkce(verifier:string){return createHash('sha256').update(verifier).digest('base64url');}
export async function delegatedCredential(event:Pick<CtxEvent,'platform'|'request'|'url'>){
 const raw=event.request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
 if(!raw)return null;
 const env=bindings(event.platform),now=nowMs();
 const token=await qOne<{grant_id:string;user_id:string;org_slug:string;client_id:string;scope:string;expires_at:number}>(env.DB,`SELECT g.id AS grant_id,g.user_id,o.slug AS org_slug,g.client_id,g.scope,t.expires_at FROM mcp_tokens t JOIN mcp_grants g ON g.id=t.grant_id JOIN organizations o ON o.id=g.org_id WHERE t.token_hash=?1 AND t.resource=?2 AND t.expires_at>?3 AND g.revoked_at IS NULL`,[hashToken(raw),event.url.origin+'/mcp',now]);
 if(!token)return null;
 const client=oauthClients(env.MCP_OAUTH_CLIENTS).find(c=>c.clientId===token.client_id);
 if(!client || token.scope.split(' ').some(s=>!client.scopes.includes(s)))return null;
  const {permissionsFor}=await import('./permissions');
  const rows=await qOne<{role_id:number;permissions:string}>(env.DB,`SELECT m.role_id,r.permissions FROM memberships m JOIN roles r ON r.id=m.role_id AND r.org_id=m.org_id JOIN organizations o ON o.id=m.org_id WHERE m.user_id=?1 AND o.slug=?2 AND m.removed_at IS NULL AND m.invited=0`,[token.user_id,token.org_slug]);
  if(!rows)return null;
  const permissions=permissionsFor([{userId:token.user_id,roleId:rows.role_id,active:true}],[{id:rows.role_id,permissions:rows.permissions}],token.user_id);
  if(!permissions.has('ViewTransactions'))return null;
 return {tokenHash:hashToken(raw),orgSlug:token.org_slug,clientId:token.client_id,expiresAt:token.expires_at,audience:event.url.origin+'/mcp',userId:token.user_id,scopes:token.scope.split(' '),grantId:token.grant_id};
}
