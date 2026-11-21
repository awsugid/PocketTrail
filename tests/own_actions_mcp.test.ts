import { describe, it, expect } from 'vitest';
import { testDatabase } from './helpers/sqlite';
import { ownActions, ownAction, explainOwnAction } from '../src/lib/server/own_actions';
import { mcpCredential, mcpMessage } from '../src/lib/server/mcp';
import { createOrg } from '../src/lib/server/orgs';
import { permissionsFor } from '../src/lib/server/permissions';
import { messageFor } from '../src/lib/server/notification_mail';
import { hashToken } from '../src/lib/server/tokens';
import type { TenantContext } from '../src/lib/server/auth';

async function fixture() {
 const {db}=testDatabase();
 for (const sql of [
 "INSERT INTO users(id,email,name,created_at) VALUES('u','u@example.test','User',0),('v','v@example.test','Other',0)",
 "INSERT INTO organizations(id,slug,name,created_at) VALUES(1,'one','One',0),(2,'two','Two',0)",
 "INSERT INTO roles(id,org_id,name,permissions) VALUES(10,1,'Restricted','[\"ExplainOwnActions\"]')",
 "INSERT INTO memberships(id,org_id,user_id,role_id,handle,created_at) VALUES(1,1,'u',10,'u',0),(2,1,'v',10,'v',0),(3,2,'u',10,'u',0)",
 "INSERT INTO pockets(id,org_id,name,owner_membership_id) VALUES(1,1,'One',1),(2,2,'Two',3)",
 "INSERT INTO transactions(id,org_id,pocket_id,txn_date,amount_minor,responsible_membership_id,created_at,updated_at) VALUES(1,1,1,'2026-01-01',-100,1,0,0),(2,1,1,'2026-01-01',-200,2,0,0),(3,2,2,'2026-01-01',-300,1,0,0),(4,1,1,'2026-01-01',100,1,0,0)"
 ]) await db.prepare(sql).run();
 const ctx={db,org:{id:1,slug:'one'},user:{id:'u'},memberRows:[{id:1,user_id:'u',removed_at:null,invited:0}]} as TenantContext;
 return {db,ctx};
}
describe('restricted Actions',()=>{
 it('new organization admin keeps full rights and restricted role stays separate',async()=>{
 const {db}=await fixture();
 const form=new FormData(); for(const [k,v] of Object.entries({name:'New org',slug:'new-org',csrf_token:'csrf'})) form.set(k,v);
 await expect(createOrg({request:new Request('https://example.test/orgs'),url:new URL('https://example.test/orgs')} as any,{db,user:{id:'u',is_platform_admin:1},session:{csrf:'csrf'}} as any,form)).rejects.toMatchObject({status:303});
 const role=await db.prepare("SELECT id,permissions FROM roles WHERE name='Admin' AND org_id=(SELECT id FROM organizations WHERE slug='new-org')").first<{id:number;permissions:string}>();
 expect(role).not.toBeNull();
 const grants=permissionsFor([{userId:'u',roleId:role!.id,active:true}],[role!],'u');
 expect(grants.has('ManageRoles')).toBe(true); expect(grants.has('ViewTransactions')).toBe(true); expect(grants.has('ExplainOwnActions')).toBe(false);
 });
 it('closed expenses excluded and reassigned tasks denied',async()=>{
 const {db,ctx}=await fixture();
 await db.prepare("UPDATE transactions SET status='approved' WHERE id=1").run();
 expect(await ownActions(ctx)).toEqual([]); await expect(ownAction(ctx,1)).rejects.toMatchObject({status:404});
 await db.prepare("UPDATE transactions SET status='pending',responsible_membership_id=2,revision=revision+1 WHERE id=1").run();
 const form=new FormData();form.set('revision','0:0');form.set('explanation','Old assignment');
 await expect(explainOwnAction(ctx,1,form)).rejects.toMatchObject({status:404});
 });
 it('two allocation assignees complete independently without overwriting shared data',async()=>{
 const {db,ctx}=await fixture();
 await db.prepare("UPDATE transactions SET explanation='Shared financial notes' WHERE id=1").run();
 await db.prepare("INSERT INTO purposes(id,org_id,name,kind,created_by_membership_id,created_at,updated_at) VALUES(1,1,'Food','expense',1,0,0),(2,1,'Travel','expense',1,0,0)").run();
 await db.prepare('INSERT INTO allocations(org_id,purpose_id,transaction_id,amount_minor,responsible_membership_id,created_at) VALUES(1,1,1,50,1,0),(1,2,1,50,2,0)').run();
 const other={...ctx,user:{id:'v'},memberRows:[{id:2,user_id:'v',removed_at:null,invited:0}]} as TenantContext;
 const before=(await ownActions(other)).map(t=>t.id);
 const form=new FormData();form.set('revision',(await ownAction(ctx,1)).revision);form.set('explanation','My allocation explanation');await explainOwnAction(ctx,1,form);
 expect(await ownActions(ctx)).toEqual([]);expect((await ownActions(other)).map(t=>t.id)).toEqual(before);
 expect(await db.prepare('SELECT explanation,revision FROM transactions WHERE id=1').first()).toEqual({explanation:'Shared financial notes',revision:0});
 await explainOwnAction(other,1,form);expect((await ownActions(other)).map(t=>t.id)).not.toContain(1);
 expect(await db.prepare('SELECT count(*) AS n FROM action_responses WHERE transaction_id=1').first()).toEqual({n:2});
 });
 it('purpose away/back invalidates completed response and stale form across multiple allocations',async()=>{
 const {db,ctx}=await fixture();
 await db.prepare("INSERT INTO purposes(id,org_id,name,kind,created_by_membership_id,created_at,updated_at) VALUES(1,1,'Food','expense',1,0,0),(2,1,'Travel','expense',1,0,0)").run();
 await db.prepare('INSERT INTO purpose_responsibles(purpose_id,membership_id,since) VALUES(1,1,0),(2,1,0)').run();
 await db.prepare('INSERT INTO allocations(org_id,purpose_id,transaction_id,amount_minor,created_at) VALUES(1,1,1,50,0),(1,2,1,50,0)').run();
 const initial=(await ownAction(ctx,1)).revision;
 const form=new FormData();form.set('revision',initial);form.set('explanation','Original assignment');
 await explainOwnAction(ctx,1,form);expect(await ownActions(ctx)).toEqual([]);
 // Notes and purpose revision alone are not assignment changes.
 await db.prepare("UPDATE purposes SET notes='New notes',revision=revision+1 WHERE id=1").run();
 expect((await ownAction(ctx,1)).revision).toBe(initial);expect(await ownActions(ctx)).toEqual([]);
 // A retains purpose 1 while purpose 2 goes A -> B -> A.
 await db.prepare('UPDATE purpose_responsibles SET membership_id=2 WHERE purpose_id=2 AND membership_id=1').run();
 await db.prepare('UPDATE purpose_responsibles SET membership_id=1 WHERE purpose_id=2 AND membership_id=2').run();
 expect((await ownActions(ctx)).map(t=>t.id)).toContain(1);
 await expect(explainOwnAction(ctx,1,form)).rejects.toMatchObject({status:409});
 const current=(await ownAction(ctx,1)).revision;expect(current).not.toBe(initial);
 form.set('revision',current);await explainOwnAction(ctx,1,form);expect(await ownActions(ctx)).toEqual([]);
 // Delete/insert reassignment path must also advance generation.
 await db.prepare('DELETE FROM purpose_responsibles WHERE purpose_id=1').run();
 await db.prepare('INSERT INTO purpose_responsibles(purpose_id,membership_id,since) VALUES(1,2,1)').run();
 await db.prepare('DELETE FROM purpose_responsibles WHERE purpose_id=1').run();
 await db.prepare('INSERT INTO purpose_responsibles(purpose_id,membership_id,since) VALUES(1,1,2)').run();
 await expect(explainOwnAction(ctx,1,form)).rejects.toMatchObject({status:409});
 expect((await ownActions(ctx)).map(t=>t.id)).toContain(1);
 expect(await db.prepare('SELECT count(*) AS n FROM action_responses WHERE transaction_id=1').first()).toEqual({n:2});
 });
 it('allocation override away/back advances identity; unrelated purpose assignment does not',async()=>{
 const {db,ctx}=await fixture();
 await db.prepare("INSERT INTO purposes(id,org_id,name,kind,created_by_membership_id,created_at,updated_at) VALUES(1,1,'Food','expense',1,0,0)").run();
 await db.prepare('INSERT INTO allocations(org_id,purpose_id,transaction_id,amount_minor,responsible_membership_id,created_at) VALUES(1,1,1,100,1,0)').run();
 const initial=(await ownAction(ctx,1)).revision;
 await db.prepare('INSERT INTO purpose_responsibles(purpose_id,membership_id,since) VALUES(1,2,0)').run();
 expect((await ownAction(ctx,1)).revision).toBe(initial);
 await db.prepare('UPDATE allocations SET responsible_membership_id=2 WHERE transaction_id=1').run();
 await db.prepare('UPDATE allocations SET responsible_membership_id=1 WHERE transaction_id=1').run();
 const form=new FormData();form.set('revision',initial);form.set('explanation','Stale allocation');
 await expect(explainOwnAction(ctx,1,form)).rejects.toMatchObject({status:409});
 expect((await ownAction(ctx,1)).revision).not.toBe(initial);
 });
 it('mixed permissions never broaden action-only role',()=>{
 expect([...permissionsFor([{userId:'u',roleId:1,active:true}],[{id:1,permissions:'["ExplainOwnActions","ViewTransactions","ManageRoles"]'}],'u')]).toEqual(['ExplainOwnActions']);
 });
 it('only assigned expense; other member, organization, income hidden; save audited and stale save denied',async()=>{
 const {db,ctx}=await fixture();
 expect((await ownActions(ctx)).map(t=>t.id)).toEqual([1]);
 for (const id of [2,3,4]) await expect(ownAction(ctx,id)).rejects.toMatchObject({status:404});
 const form=new FormData(); form.set('revision',(await ownAction(ctx,1)).revision); form.set('explanation','Dinner for event volunteers');
 await explainOwnAction(ctx,1,form);
 expect(await ownActions(ctx)).toEqual([]);
 expect(await db.prepare("SELECT action FROM audit_events WHERE actor_id='u'").first()).toEqual({action:'action.explained'});
 await expect(explainOwnAction(ctx,1,form)).rejects.toMatchObject({status:409});
 });
});
describe('historical exemption and invite mail',()=>{
 it('exemption remains distinct from approval and rejects cross-org mapping',async()=>{
 const {db}=await fixture();
 await db.prepare("INSERT INTO purposes(id,org_id,name,kind,created_by_membership_id,created_at,updated_at) VALUES(1,1,'Historical','expense',1,0,0)").run();
 await db.prepare("INSERT INTO historical_approval_exemptions(org_id,purpose_id,source_reference,reason,actor_id,created_at) VALUES(1,1,'Sheet tab row 10','Reviewed exact source','u',0)").run();
 expect(await db.prepare('SELECT status FROM purposes WHERE id=1').first()).toEqual({status:'pending'});
 await expect(db.prepare("INSERT INTO historical_approval_exemptions(org_id,purpose_id,source_reference,reason,actor_id,created_at) VALUES(2,1,'Row 10','Wrong org','u',0)").run()).rejects.toThrow('Wrong exemption organization');
 });
 it('restricted invite email requests purpose, links only to Actions, carries no financial details',()=>{
 const mail=messageFor({kind:'assignment',rows:[{org_name:'One',org_slug:'one',email:'u@example.test',name:'User',invited:1,role_permissions:'["ExplainOwnActions"]',transaction_id:1,amount_minor:-999999,counterparty:'Private vendor'}]} as any,'https://finance.example.test');
 expect(mail.body).toContain('Why did these expenses happen?');
 expect(mail.body).toContain('/org/one/actions');
 expect(mail.body).not.toContain('999999'); expect(mail.body).not.toContain('Private vendor'); expect(mail.body).not.toContain('/transactions/');
 });
});
describe('read-only MCP',()=>{
 it('requires bearer, audience, expiry and trusted Origin',()=>{
 const token='x'.repeat(43), url=new URL('https://finance.example.test/mcp');
 const config=JSON.stringify([{tokenHash:hashToken(token),orgSlug:'one',clientId:'assistant',expiresAt:Date.now()+60000,audience:url.href}]);
 expect(()=>mcpCredential(new Request(url),url,config)).toThrow();
 expect(()=>mcpCredential(new Request(url,{headers:{authorization:`Bearer ${token}`,origin:'https://evil.test'}}),url,config)).toThrow();
 expect(mcpCredential(new Request(url,{headers:{authorization:`Bearer ${token}`}}),url,config).orgSlug).toBe('one');
 expect(()=>mcpCredential(new Request(url,{headers:{authorization:`Bearer ${token}`}}),url,config.replace(url.href,'https://other.test/mcp'))).toThrow();
 });
 it('scopes details and summaries; records AI not human; no writes or impersonation',async()=>{
 const {db}=await fixture();
 const credential={orgSlug:'one',clientId:'assistant',expiresAt:Date.now()+60000,audience:'https://finance.example.test/mcp',tokenHash:''};
 const call=(name:string,args:unknown)=>mcpMessage(db,credential,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
 const hidden=await call('transaction_details',{id:3});
 expect(JSON.stringify(hidden)).toContain('isError'); expect(JSON.stringify(hidden)).not.toContain('-300');
 expect(JSON.parse((await call('finance_summary',{}) as any).result.content[0].text).data).toMatchObject({incomeMinor:100,expenseMinor:300,netMinor:-200});
 expect(await db.prepare('SELECT actor_id,action FROM audit_events LIMIT 1').first()).toEqual({actor_id:null,action:'ai.mcp.read'});
 expect(JSON.stringify(await call('approve',{}))).toContain('Unknown read-only tool');
 expect(JSON.stringify(await call('transaction_details',{id:1,actor:'human'}))).toContain('Invalid arguments');
 });
});
