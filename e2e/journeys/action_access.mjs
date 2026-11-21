import { Client, run } from '../harness.mjs';
import { signIn } from './_util.mjs';
function sql(command) { return JSON.parse(run('npx',['wrangler','d1','execute','DB','--local','--json','--command',command]))[0].results; }
export async function checks({extractCsrf}) {
 let failures=0;
 const check=(name,ok)=>{console.log(`  ${ok?'ok  ':'FAIL'} ${name}`);if(!ok)failures++;};
 const client=new Client();await signIn(client,extractCsrf,'alice');
 sql(`UPDATE roles SET permissions='["ExplainOwnActions","ViewTransactions"]' WHERE id=(SELECT role_id FROM memberships WHERE id=1)`);
 const rows=sql("SELECT id,revision || ':' || action_assignment_generation AS revision FROM transactions WHERE org_id=1 AND amount_minor<0 AND suppressed=0 AND responsible_membership_id=1 AND NOT EXISTS(SELECT 1 FROM allocations a WHERE a.transaction_id=transactions.id) LIMIT 1");
 const id=rows[0]?.id;
 for(const path of ['transactions','purposes','imports','settings','inventory','documents/1','transactions/1','purposes/1']) check(`restricted direct ${path} denied`,(await client.get(`/org/demo-jakarta/${path}`)).status===403);
 sql("INSERT INTO organizations(slug,name,created_at) VALUES('isolated-org','Isolated',0)");
  check('other org denied',(await client.get('/org/isolated-org/actions')).status===403);
 const page=await client.get('/org/demo-jakarta/actions');check('own Actions accessible',page.status===200);
 if(id){
 const path=`/org/demo-jakarta/actions/${id}`,detail=await client.get(path),csrf=extractCsrf(await detail.text());
 check('own detail accessible',detail.status===200);
 check('missing CSRF rejected',(await client.postForm(path,{explanation:'Purpose',revision:String(rows[0].revision)})).status===403);
 check('cross-origin rejected',(await client.postForm(path,{csrf_token:csrf,explanation:'Purpose',revision:String(rows[0].revision)},{origin:'https://evil.test'})).status===403);
 sql(`UPDATE transactions SET responsible_membership_id=2,revision=revision+1 WHERE id=${id}`);
 check('reassigned POST denied',(await client.postForm(path,{csrf_token:csrf,explanation:'Stale',revision:String(rows[0].revision)})).status===404);
 }else check('unallocated fixture exists',false);
 return failures;
}
