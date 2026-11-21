import { describe, expect, it } from 'vitest';
import { parseListFilters, viewerTone, matchesCommon, paginate } from '../src/lib/server/list_filters';
import { toEntry, LIST_SQL, filteredLedgerPage } from '../src/lib/server/ledger';
import { filteredPurposesPage } from '../src/lib/server/purposes';
import { testDatabase } from './helpers/sqlite';
import type { TxnCtx } from '../src/lib/server/txns';

describe('list filters', () => {
 it('validates dates, amounts, repeated ids and status', () => {
 const f = parseListFilters(new URLSearchParams('q=Food&status=pending_review&from=2026-02-29&to=2026-03-01&min=12.34&max=20&tag=2&tag=2&tag=-1&tag=3&responsible=9007199254740992&page=2'));
 expect(f).toMatchObject({q:'Food',status:'pending_review',from:null,to:'2026-03-01',min:1234,max:2000,tag:[2,3],responsible:[],page:2});
 expect(parseListFilters(new URLSearchParams('status=pending&min=NaN&dir=bad&page=1e2'))).toMatchObject({status:null,min:null,dir:null,page:1});
 expect(parseListFilters(new URLSearchParams('min=20&max=10&from=2026-03-02&to=2026-03-01'))).toMatchObject({min:null,max:null,from:null,to:null});
 });
 it('uses AND across fields, OR within fields', () => {
 const f = parseListFilters(new URLSearchParams('tag=1&tag=2&responsible=4&responsible=5&min=1'));
 const row = {status:'needs_details' as const,tone:'action' as const,responsibles:[{id:5}]};
 expect(matchesCommon(f,row,100,[2])).toBe(true);
 expect(matchesCommon(f,row,100,[3])).toBe(false);
 expect(matchesCommon(f,row,99,[2])).toBe(false);
 });
 it('paginates after filtering and clamps out of range pages', () => {
 expect(paginate(Array.from({length:51},(_,i) => i),9)).toMatchObject({entries:[50],total:51,pageCount:2,page:2,hasNext:false});
 });
});
describe('filtered list database contract', () => {
 it('uses effective members, full filtered summaries, actor mapping and organization boundaries', async () => {
 const {db,sqlite} = testDatabase();
 sqlite.exec(`INSERT INTO users(id,email,name,created_at) VALUES('u','u@test','User',0),('v','v@test','Viewer',0);
 INSERT INTO organizations(id,slug,name,created_at) VALUES(1,'one','One',0),(2,'two','Two',0);
 INSERT INTO roles(id,org_id,name,permissions) VALUES(1,1,'Member','[]');
 INSERT INTO memberships(id,org_id,user_id,role_id,handle,created_at) VALUES(1,1,'u',1,'user',0),(2,1,'v',1,'viewer',0);
 INSERT INTO pockets(id,org_id,name,opening_balance_minor,owner_membership_id) VALUES(1,1,'Main',0,1);
 INSERT INTO transactions(id,org_id,pocket_id,bank_id,txn_date,txn_time,counterparty,amount_minor,balance_minor,explanation,status,responsible_membership_id,created_at,updated_at) VALUES
 (1,1,1,'B1','2026-01-01','12:00','Shop',-10000,20000,'','pending',1,0,0),
 (2,1,1,'B2','2026-01-02','12:00','Sponsor',5000,NULL,'Donation','pending',1,0,0);
 INSERT INTO purposes(id,org_id,name,kind,notes,status,created_by_membership_id,created_at,updated_at) VALUES(1,1,'Food','expense','','pending',1,0,0),(2,2,'Secret','expense','','pending',1,0,0);
 INSERT INTO purpose_responsibles(purpose_id,membership_id,since) VALUES(1,1,0);
 INSERT INTO allocations(org_id,purpose_id,transaction_id,amount_minor,responsible_membership_id,created_at) VALUES(1,1,1,10000,2,0);
 INSERT INTO tags(id,org_id,name) VALUES(1,1,'Meetup');
 INSERT INTO transaction_tags(org_id,transaction_id,tag_id) VALUES(1,1,1);
 INSERT INTO actor_mappings(id,org_id,pocket_id,pattern,membership_id,created_by_membership_id,created_at) VALUES(1,1,1,'Shop',1,1,0);`);
 const selection = parseListFilters(new URLSearchParams('purpose=1&actor=1&tag=1&responsible=2&status=needs_action'));
 const page = await filteredLedgerPage(db,1,selection,{membershipIds:[2],reviewer:false});
 expect(page.total).toBe(1);
 expect(page.entries[0]).toMatchObject({status:'needs_details',tone:'action',unallocatedMinor:0,responsibles:[{id:2}]});
 expect(page.summary).toMatchObject({closingBalance:20000,expense:10000,income:0,net:-10000,needsActionAmount:10000});
 expect(page.filterOptions.purposes).toEqual([{id:1,name:'Food'}]);
 const income = await filteredLedgerPage(db,1,parseListFilters(new URLSearchParams('dir=in&status=pending_review')),{membershipIds:[2],reviewer:true});
 expect(income.entries[0]).toMatchObject({bankId:'B2',status:'pending_review',tone:'review'});
 expect(income.summary.closingBalance).toBeNull();
 const ctx = {db,org:{id:1,slug:'one'},user:{id:'v'},memberRows:[{id:2,user_id:'v',removed_at:null,invited:0}],can:() => true} as unknown as TxnCtx;
 const purposes = await filteredPurposesPage(ctx,parseListFilters(new URLSearchParams('tag=1&responsible=2')));
 expect(purposes.total).toBe(1);
 expect(purposes.entries[0]).toMatchObject({totalAllocatedMinor:10000,status:'needs_details',tone:'action',responsibles:[{id:2}],transactions:[{id:1,allocatedMinor:10000}]});
 expect(purposes.summary).toMatchObject({totalAllocated:10000,needsActionCount:1,byStatus:{needs_details:1}});
 });
});

describe('allocation list regressions', () => {
 function fixture() {
 const world = testDatabase();
 world.sqlite.exec(`INSERT INTO users(id,email,name,created_at) VALUES('a','a@test','Alice',0),('b','b@test','Bob',0);
 INSERT INTO organizations(id,slug,name,created_at) VALUES(1,'one','One',0);
 INSERT INTO roles(id,org_id,name,permissions) VALUES(1,1,'Member','[]');
 INSERT INTO memberships(id,org_id,user_id,role_id,handle,created_at) VALUES(1,1,'a',1,'alice',0),(2,1,'b',1,'bob',0);
 INSERT INTO pockets(id,org_id,name,opening_balance_minor,owner_membership_id) VALUES(1,1,'Main',0,1);
 INSERT INTO transactions(id,org_id,pocket_id,txn_date,counterparty,amount_minor,status,responsible_membership_id,created_at,updated_at) VALUES(1,1,1,'2026-01-01','Shop',-10000,'pending',1,0,0);
 INSERT INTO purposes(id,org_id,name,kind,notes,status,created_by_membership_id,created_at,updated_at) VALUES(1,1,'Food','expense','Complete notes','pending',1,0,0),(2,1,'Venue','expense','Complete notes','approved',1,0,0);
 INSERT INTO purpose_responsibles(purpose_id,membership_id,since) VALUES(1,2,0),(2,1,0);
 INSERT INTO allocations(org_id,purpose_id,transaction_id,amount_minor,created_at) VALUES(1,1,1,10000,0);`);
 return world;
 }
 it('requires persisted submission, not complete purpose notes', async () => {
 const {db,sqlite} = fixture();
 const selection = parseListFilters(new URLSearchParams());
 const viewer = {membershipIds:[2],reviewer:false};
 const draft = await filteredLedgerPage(db,1,selection,viewer);
 expect(draft.entries[0]).toMatchObject({status:'needs_details',tone:'action',allocations:[{status:'needs_details'}]});
 sqlite.exec("UPDATE purposes SET status='submitted' WHERE id=1");
 const submitted = await filteredLedgerPage(db,1,selection,viewer);
 expect(submitted.entries[0]).toMatchObject({status:'pending_review',tone:'waiting',allocations:[{status:'pending_review'}]});
 });
 it('keeps cross-member tone, action filter and summary aligned with allocation duties', async () => {
 const {db,sqlite} = fixture();
 sqlite.exec("UPDATE purposes SET status='changes_requested' WHERE id=1; UPDATE allocations SET amount_minor=6000; INSERT INTO allocations(org_id,purpose_id,transaction_id,amount_minor,created_at) VALUES(1,2,1,4000,0)");
 for (const [membershipId,tone,count] of [[1,'none',0],[2,'action',1]] as const) {
 const viewer = {membershipIds:[membershipId],reviewer:false};
 const page = await filteredLedgerPage(db,1,parseListFilters(new URLSearchParams()),viewer);
 const filtered = await filteredLedgerPage(db,1,parseListFilters(new URLSearchParams('status=needs_action')),viewer);
 expect(page.entries[0]).toMatchObject({status:'changes_requested',tone});
 expect(page.summary).toMatchObject({needsActionCount:count,needsActionAmount:count*10000});
 expect(filtered.total).toBe(count);
 expect(filtered.summary).toMatchObject({needsActionCount:count,needsActionAmount:count*10000});
 }
 sqlite.exec("UPDATE purposes SET status='submitted' WHERE id=2");
 for (const [membershipId,reviewer,tone] of [[1,false,'waiting'],[1,true,'review'],[2,true,'action']] as const) {
 const page = await filteredLedgerPage(db,1,parseListFilters(new URLSearchParams()),{membershipIds:[membershipId],reviewer});
 expect(page.entries[0]).toMatchObject({tone});
 }
 });
 it('keeps approved partial expenses needing details from transaction responsible', async () => {
 const {db,sqlite} = fixture();
 sqlite.exec("UPDATE purposes SET status='approved' WHERE id=1; UPDATE allocations SET amount_minor=6000");
 for (const [membershipId,tone,count] of [[1,'action',1],[2,'none',0]] as const) {
 const viewer = {membershipIds:[membershipId],reviewer:false};
 const page = await filteredLedgerPage(db,1,parseListFilters(new URLSearchParams()),viewer);
 expect(page.entries[0]).toMatchObject({status:'needs_details',tone,unallocatedMinor:4000,allocations:[{status:'approved'}]});
 expect(page.summary).toMatchObject({needsActionCount:count,needsActionAmount:count*10000});
 const filtered = await filteredLedgerPage(db,1,parseListFilters(new URLSearchParams('status=needs_action')),viewer);
 expect(filtered.total).toBe(count);
 }
 sqlite.exec('UPDATE allocations SET amount_minor=10000');
 const full = await filteredLedgerPage(db,1,parseListFilters(new URLSearchParams()),{membershipIds:[1],reviewer:false});
 expect(full.entries[0]).toMatchObject({status:'approved',tone:'none',unallocatedMinor:0});
 });
});

describe('viewer tone', () => {
 it('assigns action, review, waiting and none without confusing responsibility and review', () => {
 expect(viewerTone('needs_details',true,true)).toBe('action');
 expect(viewerTone('changes_requested',true,false)).toBe('action');
 expect(viewerTone('pending_review',true,true)).toBe('review');
 expect(viewerTone('pending_review',true,false)).toBe('waiting');
 expect(viewerTone('needs_details',false,true)).toBe('none');
 expect(viewerTone('approved',true,true)).toBe('none');
 });
});
describe('allocated ledger documentation', () => {
 const row = {id:1,pocket_name:'Main',txn_date:'2026-01-01',txn_time:null,counterparty:'Shop',transaction_type:'',amount_minor:-100,balance_minor:null,explanation:'',evidence_unavailable_reason:'',status:'pending',suppressed:0,responsible_membership_id:1,responsible_name:'One',evidence_count:0,derived_status:'needs'};
 it('passes owed, not its inverse, to labels and tones', () => {
 expect(toEntry(row)).toMatchObject({statusLabel:'Needs details',statusTone:'needs',needsDetails:true});
 expect(toEntry({...row,derived_status:'submitted'})).toMatchObject({statusLabel:'Pending review',statusTone:'review',needsDetails:false});
 });
 it('legacy SQL accepts income notes without evidence', () => {
 expect(LIST_SQL.match(/amount_minor > 0 OR trim\(evidence_unavailable_reason\)/g)).toHaveLength(2);
 });
});
