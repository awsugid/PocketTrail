import {it,expect} from 'vitest';
import {testDatabase} from './helpers/sqlite';
import {issueCode,pkce} from '../src/lib/server/mcp_oauth';
import {POST as exchange} from '../src/routes/oauth/token/+server';
import {POST as mcp} from '../src/routes/mcp/+server';
import {newSession,encodeCookie} from '../src/lib/server/session';

it('Google-backed session consents; PKCE exchange, scoped writes and trusted atomic AI audit',async()=>{
 const {db}=testDatabase();
 for(const sql of ["INSERT INTO users(id,email,name,google_sub,created_at) VALUES('u','u@example.test','User','google-sub',0)","INSERT INTO organizations(id,slug,name,created_at) VALUES(1,'one','One',0),(2,'two','Two',0)","INSERT INTO roles(id,org_id,name,permissions) VALUES(1,1,'Admin','[\"ViewTransactions\",\"DocumentTransactions\"]')","INSERT INTO memberships(id,org_id,user_id,role_id,handle,created_at) VALUES(1,1,'u',1,'u',0)","INSERT INTO pockets(id,org_id,name,owner_membership_id) VALUES(1,1,'Main',1)","INSERT INTO transactions(id,org_id,pocket_id,txn_date,amount_minor,responsible_membership_id,created_at,updated_at) VALUES(1,1,1,'2026-01-01',100,1,0,0)"])await db.prepare(sql).run();
 const secret='test-session-key-with-at-least-32-characters',verifier='v'.repeat(43),origin='https://finance.example.test';
 const env={DB:db,SECRET_SESSION_KEY:secret,MCP_OAUTH_CLIENTS:JSON.stringify([{clientId:'test',name:'Test AI',redirectUris:['http://127.0.0.1:123/callback'],scopes:['finance:read','income:write','tags:write','purposes:read','purposes:write']}])};
 const session=await newSession(secret,'u',Math.floor(Date.now()/1000)),cookie=await encodeCookie(secret,session);
 const url=new URL(origin+'/oauth/authorize');for(const [k,v]of Object.entries({client_id:'test',redirect_uri:'http://127.0.0.1:987/callback',response_type:'code',resource:origin+'/mcp',state:'s'.repeat(20),code_challenge:pkce(verifier),code_challenge_method:'S256',scope:'finance:read income:write tags:write purposes:read purposes:write'}))url.searchParams.set(k,v);
 const event={url,platform:{env},cookies:{get:()=>cookie},request:new Request(url)} as any;
 await expect(issueCode({...event,url:new URL(url.href.replace('callback','evil'))},'one')).rejects.toMatchObject({status:400});
 const callback=await issueCode(event,'one'),code=new URL(callback).searchParams.get('code')!;
 async function token(v:string,callback='http://127.0.0.1:987/callback'){const form=new URLSearchParams({grant_type:'authorization_code',client_id:'test',redirect_uri:callback,resource:origin+'/mcp',code,code_verifier:v});return exchange({url:new URL(origin+'/oauth/token'),platform:{env},request:new Request(origin+'/oauth/token',{method:'POST',body:form})} as any);}
 expect((await token('wrong'.repeat(10))).status).toBe(400);
  expect((await token(verifier,'http://127.0.0.1:123/callback')).status).toBe(400);
 const response=await token(verifier),issued=await response.json();let access=issued.access_token;
  const refresh=async(raw:string)=>exchange({url:new URL(origin+'/oauth/token'),platform:{env},request:new Request(origin+'/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:'test',refresh_token:raw,resource:origin+'/mcp'})})} as any);
  await db.prepare('UPDATE mcp_grants SET created_at=?1').bind(Date.now()-89*86400000).run();
   const refreshed=await refresh(issued.refresh_token);expect(refreshed.status).toBe(200);const rotated=await refreshed.json();expect(rotated.refresh_token).not.toBe(issued.refresh_token);access=rotated.access_token;
    const expiry=await db.prepare('SELECT MAX(expires_at) AS expiry FROM mcp_refresh_tokens WHERE used_at IS NULL').first<{expiry:number}>();expect(expiry!.expiry).toBeLessThanOrEqual(Date.now()+86400000);expect(response.status).toBe(200);expect((await token(verifier)).status).toBe(400);
 let sid='';
 async function rpc(method:string,params?:unknown){return mcp({platform:{env},url:new URL(origin+'/mcp'),request:new Request(origin+'/mcp',{method:'POST',headers:{authorization:'Bearer '+access,accept:'application/json, text/event-stream','content-type':'application/json','mcp-protocol-version':'2025-11-25',...(sid?{'mcp-session-id':sid}:{})},body:JSON.stringify({jsonrpc:'2.0',...(method.startsWith('notifications/')?{}:{id:1}),method,params})})} as any);}
 const init=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'AI',version:'1'}});sid=init.headers.get('mcp-session-id')!;await rpc('notifications/initialized');
 expect((await (await rpc('tools/list')).json()).result.tools).toHaveLength(8);
 const call=async(name:string,args:unknown)=>(await (await rpc('tools/call',{name,arguments:args})).json()).result;
 expect((await call('list_transactions',{})).isError).toBe(false);
  const read=async(name:string,args={})=>JSON.parse((await call(name,args)).content[0].text).data;
  expect(await read('finance_summary')).toEqual((await read('list_transactions')).summary);
  for(const page of [2,9999]){
   const listed=await read('list_transactions',{filters:'page='+page});
   expect(listed).toMatchObject({page:1,selection:{page:1,minMinor:null,maxMinor:null},total:1});
  }
  for(const name of ['transaction_details','purpose_details'])expect(await call(name,{id:999999999})).toEqual({isError:true,content:[{type:'text',text:name==='transaction_details'?'Transaction not found':'Purpose not found'}]});
  const tools=(await (await rpc('tools/list')).json()).result.tools;
  for(const tool of tools){
   expect(tool.description.length).toBeGreaterThan(60);
   expect(tool.annotations).toMatchObject({readOnlyHint:!['set_income_notes','set_transaction_tag','allocate_transaction'].includes(tool.name)});
   if(!tool.annotations.readOnlyHint)expect(tool.annotations).toMatchObject({destructiveHint:true,idempotentHint:false});
   const checkProperties=(schema:any)=>{for(const property of Object.values(schema.properties ?? {}) as any[]){expect(property.description).toBeTruthy();if(property.items)checkProperties(property.items);}};
   checkProperties(tool.inputSchema);
  }
  expect(await read('transaction_details',{id:1})).toMatchObject({status:'needs_details',statusLabel:'Needs details',direction:'in',amountMinor:100,revision:0,tags:[]});
  await db.prepare("INSERT INTO purposes(id,org_id,name,kind,created_by_membership_id,created_at,updated_at) VALUES(1,1,'Sponsor','income',1,0,0)").run();
  expect((await call('list_purposes',{})).isError).toBe(false);
   for(const page of [2,9999])expect(await read('list_purposes',{filters:'page='+page})).toMatchObject({page:1,selection:{page:1},total:1});
   await db.prepare("INSERT INTO purposes(id,org_id,name,kind,created_by_membership_id,created_at,updated_at) VALUES(99,2,'Foreign','expense',1,0,0)").run();
   expect(await call('purpose_details',{id:99})).toMatchObject({isError:true,content:[{text:'Purpose not found'}]});
  expect((await call('purpose_details',{id:1})).isError).toBe(false);
   expect((await call('approve_purpose',{id:1,revision:0,note:''})).isError).toBe(true);
   await db.prepare("UPDATE roles SET permissions='[\"ViewTransactions\",\"DocumentTransactions\",\"ApproveTransactions\"]' WHERE id=1").run();
   await db.prepare("INSERT INTO purposes(id,org_id,name,kind,status,created_by_membership_id,created_at,updated_at) VALUES(2,1,'Review','expense','submitted',1,0,0)").run();
   const approved=await call('approve_purpose',{id:2,revision:1,note:'Verified'});expect(approved,JSON.stringify(approved)).toMatchObject({isError:false});
   expect(await db.prepare('SELECT details FROM purpose_audit WHERE purpose_id=2').first()).toEqual({details:expect.stringContaining('via AI client on behalf of User')});
   await db.prepare("INSERT INTO purposes(id,org_id,name,kind,status,created_by_membership_id,created_at,updated_at) VALUES(3,1,'Changes','expense','submitted',1,0,0)").run();
   expect((await call('request_purpose_changes',{id:3,revision:1,note:'Need receipt'})).isError).toBe(false);
  expect((await call('set_income_notes',{id:1,revision:0,notes:'Sponsor support',actor:'human'})).isError).toBe(true);
 expect((await call('set_income_notes',{id:1,revision:0,notes:'Sponsor support'})).isError).toBe(false);
 expect(await db.prepare("SELECT actor_id,actor_type,delegated_user_id,client_id FROM audit_events WHERE action='transaction.income_notes_updated'").first()).toEqual({actor_id:null,actor_type:'AI',delegated_user_id:'u',client_id:'test'});
 expect(await db.prepare('SELECT actor_type FROM transaction_audit').first()).toEqual({actor_type:'AI'});
 expect((await call('set_income_notes',{id:1,revision:0,notes:'Retry stale'})).isError).toBe(true);
 await db.prepare("CREATE TRIGGER reject_ai_audit BEFORE INSERT ON audit_events WHEN NEW.actor_type='AI' AND NEW.action='transaction.tags_updated' BEGIN SELECT RAISE(ABORT,'Audit unavailable'); END").run();
  expect((await call('set_transaction_tag',{id:1,revision:1,tag:'Rollback'})).isError).toBe(true);
  expect(await db.prepare('SELECT revision FROM transactions WHERE id=1').first()).toEqual({revision:1});
  expect(await db.prepare("SELECT count(*) AS n FROM tags WHERE name='Rollback'").first()).toEqual({n:0});
  await db.prepare('DROP TRIGGER reject_ai_audit').run();
  expect((await call('set_transaction_tag',{id:1,revision:1,tag:'Event'})).isError).toBe(false);
 const allocation=await call('allocate_transaction',{id:1,revision:2,justification:'Assign sponsor funds',allocations:[{purpose_id:1,amount_minor:100}]});expect(allocation,JSON.stringify(allocation)).toMatchObject({isError:false});
  expect(await db.prepare('SELECT purpose_id,amount_minor FROM allocations').first()).toEqual({purpose_id:1,amount_minor:100});
  await db.prepare("UPDATE mcp_grants SET scope='finance:read',scope_json='[\"finance:read\"]'").run();
 expect((await call('set_transaction_tag',{id:1,revision:2,tag:'Denied'})).isError).toBe(true);
 await db.prepare('UPDATE mcp_grants SET revoked_at=1').run();expect((await refresh(rotated.refresh_token)).status).toBe(400);expect((await rpc('tools/list')).status).toBe(401);
  await db.prepare('UPDATE mcp_grants SET revoked_at=NULL').run();
  await db.prepare("UPDATE roles SET permissions='[\"ViewTransactions\"]' WHERE id=1").run();
  expect((await call('set_transaction_tag',{id:1,revision:2,tag:'No permission'})).isError).toBe(true);
  await db.prepare("UPDATE roles SET permissions='[\"ExplainOwnActions\",\"ViewTransactions\"]' WHERE id=1").run();expect((await rpc('tools/list')).status).toBe(401);
   expect((await refresh(issued.refresh_token)).status).toBe(400);expect(await db.prepare('SELECT revoked_at FROM mcp_grants').first()).toEqual({revoked_at:expect.any(Number)});
});
