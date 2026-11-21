import { it, expect } from 'vitest';
import { POST } from '../src/routes/mcp/+server';
import { testDatabase } from './helpers/sqlite';
import { hashToken } from '../src/lib/server/tokens';

it('HTTP lifecycle, malformed messages, credentials and session expiry',async()=>{
 const {db}=testDatabase(),url=new URL('https://finance.example.test/mcp'),token='x'.repeat(43);
 const env={DB:db,SECRET_SESSION_KEY:'test-session-key-with-at-least-32-characters',MCP_OAUTH_CLIENTS:JSON.stringify([{clientId:'AI',name:'Test',redirectUris:['https://client.example.test/callback'],scopes:['finance:read']}])};
 for(const sql of ["INSERT INTO users(id,email,name,created_at) VALUES('u','u@example.test','User',0)","INSERT INTO organizations(id,slug,name,created_at) VALUES(1,'one','One',0)","INSERT INTO roles(id,org_id,name,permissions) VALUES(1,1,'Reader','[\"ViewTransactions\"]')","INSERT INTO memberships(id,org_id,user_id,role_id,handle,created_at) VALUES(1,1,'u',1,'u',0)","INSERT INTO mcp_grants(id,user_id,org_id,client_id,scope,scope_json,created_at) VALUES('g','u',1,'AI','finance:read','[\"finance:read\"]',0)"])await db.prepare(sql).run();
 await db.prepare('INSERT INTO mcp_tokens(token_hash,grant_id,resource,expires_at) VALUES(?1,?2,?3,?4)').bind(hashToken(token),'g',url.href,Date.now()+60000).run();
 async function post(body:unknown,headers:Record<string,string>={}) {
 return POST({url,platform:{env},request:new Request(url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream',...headers},body:typeof body==='string'?body:JSON.stringify(body)})} as any);
 }
 const request=(method:string,params?:unknown)=>({jsonrpc:'2.0',id:1,method,params});
 expect((await (await post('{')).json()).error.code).toBe(-32700);
 expect((await (await post([])).json()).error.code).toBe(-32600);
 expect((await (await post(request('initialize',{}))).json()).error.code).toBe(-32602);
 expect((await post(request('tools/list'))).status).toBe(400);
 const initialized=await post(request('initialize',{protocolVersion:'2099-01-01',capabilities:{},clientInfo:{name:'Test',version:'1'}}));
 expect((await initialized.json()).result.protocolVersion).toBe('2025-11-25');
 const id=initialized.headers.get('mcp-session-id')!;
 const headers={'mcp-session-id':id,'mcp-protocol-version':'2025-11-25'};
 expect((await post(request('tools/list'),headers)).status).toBe(400);
 expect((await post({jsonrpc:'2.0',method:'notifications/initialized'},headers)).status).toBe(202);
 expect((await (await post(request('tools/list'),headers)).json()).result.tools).toHaveLength(3);
 await expect(post(request('tools/list'),{...headers,'mcp-protocol-version':'bad'})).rejects.toMatchObject({status:400});
 await db.prepare('UPDATE mcp_sessions SET expires_at=0').run();
 await expect(post(request('tools/list'),headers)).rejects.toMatchObject({status:404});
 await db.prepare('UPDATE mcp_tokens SET expires_at=0').run();
 expect((await post(request('initialize',{}))).status).toBe(401);
});
