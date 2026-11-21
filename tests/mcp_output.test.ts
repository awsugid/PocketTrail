import {it,expect} from 'vitest';
import {mcpMessage,mcpOutput,type Credential} from '../src/lib/server/mcp';
import {testDatabase} from './helpers/sqlite';
import {filteredLedgerPage} from '../src/lib/server/ledger';
import {parseListFilters} from '../src/lib/server/list_filters';
import {MCP_SCOPES} from '../src/lib/server/mcp_oauth';
import {GET as metadata} from '../src/routes/.well-known/[metadata]/+server';
import {GET as challenge} from '../src/routes/mcp/+server';

it('masks MCP account text recursively, preserves identifiers, numeric amounts and pagination count',()=>{
 const input={total:1,page:1,selection:{page:9999,min:100,max:200},entries:[{id:123456789,bankId:'123456789012',amountMinor:-123456789,balanceMinor:200,amount:'Rp 1',counterparty:{name:'Vendor 12345678',bankAccount:'123456789012'},notes:'1234567 12345678 987654321',allocations:[{amountMinor:20}]}],filterOptions:{actors:[{pattern:'123456789'}]}};
 const output=mcpOutput(input);
 expect(output).toMatchObject({total:1,page:1,selection:{page:1,minMinor:100,maxMinor:200},entries:[{id:123456789,bankId:'123456789012',amountMinor:123456789,direction:'out',counterparty:{name:'Vendor •••• 5678',bankAccount:'•••• 9012'},notes:'1234567 •••• 5678 •••• 4321'}],filterOptions:{actors:[{pattern:'•••• 6789'}]}});
 expect(output.entries[0]).not.toHaveProperty('amount');
 expect(input.entries[0]!.counterparty.bankAccount).toBe('123456789012');
});

it('returns explicit missing/foreign transaction errors, derived detail status and common summary',async()=>{
 const {db,sqlite}=testDatabase();
 sqlite.exec(`INSERT INTO users(id,email,name,created_at) VALUES('u','u@test','User',0);
 INSERT INTO organizations(id,slug,name,created_at) VALUES(1,'one','One',0),(2,'two','Two',0);
 INSERT INTO roles(id,org_id,name,permissions) VALUES(1,1,'Member','[]'),(2,2,'Member','[]');
 INSERT INTO memberships(id,org_id,user_id,role_id,handle,created_at) VALUES(1,1,'u',1,'user',0),(2,2,'u',2,'user',0);
 INSERT INTO pockets(id,org_id,name,owner_membership_id) VALUES(1,1,'Main',1),(2,2,'Other',2);
 INSERT INTO transactions(id,org_id,pocket_id,txn_date,counterparty,bank_id,amount_minor,balance_minor,explanation,status,responsible_membership_id,created_at,updated_at) VALUES
 (1,1,1,'2026-01-01','Shop / Jago 1234567890','123456789012',-10000,20000,'Account 1234567890','pending',1,0,0),
 (2,1,1,'2026-01-02','Sponsor','B2',5000,25000,'Donation','pending',1,0,0),
 (3,2,2,'2026-01-03','Secret','B3',-999,0,'','pending',1,0,0);`);
 const credential:Credential={orgSlug:'one',clientId:'test',tokenHash:'',expiresAt:Date.now()+60000,audience:'https://test/mcp'};
 const call=async(name:string,args={})=>(await mcpMessage(db,credential,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}) as any).result;
 for(const id of [3,999999999])expect(await call('transaction_details',{id})).toEqual({isError:true,content:[{type:'text',text:'Transaction not found'}]});
 const detail=JSON.parse((await call('transaction_details',{id:1})).content[0].text).data;
 expect(detail).toMatchObject({amountMinor:10000,direction:'out',status:'needs_details',statusLabel:'Needs details',tone:'none',responsibles:[{id:1}],allocations:[],unallocatedMinor:10000,revision:0,tags:[],explanation:'Account •••• 7890',bankId:'123456789012',counterparty:{bankAccount:'•••• 7890'}});
 const summary=JSON.parse((await call('finance_summary')).content[0].text).data;
 const page=await filteredLedgerPage(db,1,parseListFilters(new URLSearchParams('page=9999')),{membershipIds:[],reviewer:false});
 expect(page.selection.page).toBe(page.page);
 expect(page.selection.page).toBe(1);
 expect(summary).toEqual(mcpOutput(page.summary));
 expect(summary).toMatchObject({incomeMinor:5000,expenseMinor:10000,netMinor:-5000,closingBalanceMinor:25000,needsActionAmountMinor:0});
 const filtered=await filteredLedgerPage(db,1,parseListFilters(new URLSearchParams('dir=out&page=2')),{membershipIds:[],reviewer:false});
 expect(filtered.selection.page).toBe(1);
 expect(mcpOutput(filtered.summary).closingBalanceMinor).toBe(20000);
});

it('advertises all scopes in metadata and initial challenge',async()=>{
 const scopes=['finance:read','purposes:read','income:write','tags:write','purposes:write'];
 expect([...MCP_SCOPES].sort()).toEqual([...scopes].sort());
 for(const name of ['oauth-protected-resource','oauth-authorization-server']){
  const response=metadata({params:{metadata:name},url:new URL('https://test/.well-known/'+name)} as any) as Response;
  expect((await response.json()).scopes_supported.sort()).toEqual([...scopes].sort());
 }
 const {db}=testDatabase();
 const response=await challenge({url:new URL('https://test/mcp'),request:new Request('https://test/mcp'),platform:{env:{DB:db}}} as any);
 expect(response.status).toBe(401);
 expect(response.headers.get('www-authenticate')).toContain('scope="finance:read purposes:read income:write tags:write purposes:write"');
});
