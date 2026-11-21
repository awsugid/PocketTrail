import { it, expect, vi } from 'vitest';
import { testDatabase } from './helpers/sqlite';
const state=vi.hoisted(()=>({ctx:null as any,form:null as FormData|null}));
vi.mock('$lib/server/txns',()=>({requireOrg:async()=>state.ctx,actionForm:async()=>state.form,numericPathId:(raw:string)=>Number(raw),txnShell:async()=>({})}));
import { actions } from '../src/routes/org/[slug]/purposes/[id]/+page.server';
it('revocation audit identifies exact exemption and scope',async()=>{
 const {db}=testDatabase();
 for(const sql of [
 "INSERT INTO users(id,email,name,created_at) VALUES('u','u@example.test','Admin',0)",
 "INSERT INTO organizations(id,slug,name,created_at) VALUES(1,'one','One',0)",
 "INSERT INTO roles(id,org_id,name,permissions) VALUES(10,1,'Admin','[]')",
 "INSERT INTO memberships(id,org_id,user_id,role_id,handle,created_at) VALUES(1,1,'u',10,'u',0)",
 "INSERT INTO purposes(id,org_id,name,kind,created_by_membership_id,created_at,updated_at) VALUES(1,1,'Historical','expense',1,0,0)",
 "INSERT INTO historical_approval_exemptions(id,org_id,purpose_id,source_reference,reason,actor_id,created_at) VALUES(7,1,1,'Sheet row 5','Verified source','u',0)"
 ])await db.prepare(sql).run();
 state.ctx={db,org:{id:1,slug:'one'},user:{id:'u'},session:{},can:()=>true};
 state.form=new FormData();state.form.set('id','7');
 await expect(actions.revokeExemption!({params:{slug:'one',id:'1'},url:new URL('https://example.test/org/one/purposes/1')} as any)).rejects.toMatchObject({status:303});
 expect(await db.prepare("SELECT target,org_id FROM audit_events WHERE action='approval.exemption_revoked'").first()).toEqual({target:'/org/one/purposes/1/exemptions/7',org_id:1});
 expect(await db.prepare('SELECT revoked_by FROM historical_approval_exemptions WHERE id=7').first()).toEqual({revoked_by:'u'});
 state.form=new FormData();state.form.set('purpose_id','999');state.form.set('revision','1');state.form.set('source_reference','Sheet tab row 8');state.form.set('reason','Verified historical record');
 const event={params:{slug:'one',id:'1'},url:new URL('https://example.test/org/one/purposes/1')} as any;
 const invalid=await actions.exempt!(event);expect(invalid).toMatchObject({status:400});
 state.form.set('confirmed','yes');state.form.set('revision','0');expect(await actions.exempt!(event)).toMatchObject({status:409});
 state.form.set('revision','1');state.ctx.can=(permission:string)=>permission!=='ApproveTransactions';
 await expect(actions.exempt!(event)).rejects.toMatchObject({status:403});state.ctx.can=()=>true;
 await expect(actions.exempt!(event)).rejects.toMatchObject({status:303});
 expect(await db.prepare('SELECT purpose_id FROM historical_approval_exemptions WHERE revoked_at IS NULL').first()).toEqual({purpose_id:1});
 expect(await db.prepare('SELECT status FROM purposes WHERE id=1').first()).toEqual({status:'pending'});
 expect(await actions.exempt!(event)).toMatchObject({status:409});
});
