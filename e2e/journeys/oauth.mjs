import {createHash} from 'node:crypto';
import {Client,run,ORIGIN} from '../harness.mjs';
import {signIn} from './_util.mjs';
const sql=(s)=>JSON.parse(run('npx',['wrangler','d1','execute','DB','--local','--json','--command',s]))[0].results;
export async function checks({extractCsrf}){
 let failures=0;const check=(name,ok)=>{console.log(`  ${ok?'ok  ':'FAIL'} ${name}`);if(!ok)failures++;};
 sql("UPDATE roles SET permissions='[\"ViewTransactions\",\"DocumentTransactions\",\"ApproveTransactions\",\"ImportStatements\",\"ManageRoles\",\"ManageMembers\",\"ManageNotifications\",\"SuppressNotifications\",\"UpdateStock\"]' WHERE id=(SELECT role_id FROM memberships WHERE user_id='alice' AND org_id=1)");
  const user=new Client();await signIn(user,extractCsrf,'alice');
 const verifier='v'.repeat(43),challenge=createHash('sha256').update(verifier).digest('base64url');
 const query=new URLSearchParams({client_id:'fixture-ai',redirect_uri:'https://client.example.test/callback',response_type:'code',resource:ORIGIN+'/mcp',scope:'finance:read income:write tags:write',state:'synthetic-state-123456',code_challenge:challenge,code_challenge_method:'S256'});
 const path='/oauth/authorize?'+query;
 async function authorize(){const page=await user.get(path),html=await page.text();check('consent names exact registered callback',html.includes('https://client.example.test/callback'));const res=await user.postForm(path,{csrf_token:extractCsrf(html),decision:'allow',org_slug:'demo-jakarta'});return new URL(res.headers.get('location')).searchParams.get('code');}
 const consent=await user.get(path),csrf=extractCsrf(await consent.text());
 const denied=await user.postForm(path,{csrf_token:csrf,decision:'deny'});check('Cancel without organization returns validated access_denied',denied.status===303 && new URL(denied.headers.get('location')).searchParams.get('error')==='access_denied');
 const code=await authorize();
 const exchange=(v)=>fetch(ORIGIN+'/oauth/token',{method:'POST',headers:{origin:'https://client.example.test'},body:new URLSearchParams({grant_type:'authorization_code',client_id:'fixture-ai',redirect_uri:'https://client.example.test/callback',resource:ORIGIN+'/mcp',code,code_verifier:v})});
 check('wrong PKCE denied',(await exchange('x'.repeat(43))).status===400);
 const replay=await Promise.all([exchange(verifier),exchange(verifier)]);check('concurrent redemption exactly one winner',replay.filter(r=>r.status===200).length===1);const winner=replay.find(r=>r.status===200);if(!winner)return failures;const access=(await winner.json()).access_token;
 check('used code replay denied',(await exchange(verifier)).status===400);
 let sid='';const rpc=(method,params)=>fetch(ORIGIN+'/mcp',{method:'POST',headers:{authorization:'Bearer '+access,accept:'application/json, text/event-stream','content-type':'application/json','mcp-protocol-version':'2025-11-25',...(sid?{'mcp-session-id':sid}:{})},body:JSON.stringify({jsonrpc:'2.0',...(method.startsWith('notifications/')?{}:{id:1}),method,params})});
 const init=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'Fixture',version:'1'}});sid=init.headers.get('mcp-session-id');await rpc('notifications/initialized');
 const t=sql('SELECT id,revision FROM transactions WHERE org_id=1 AND amount_minor>0 LIMIT 1')[0];
 const call=async(name,args)=>(await (await rpc('tools/call',{name,arguments:args})).json()).result;
 check('delegated income write succeeds',!(await call('set_income_notes',{id:t.id,revision:t.revision,notes:'Synthetic OAuth test'})).isError);
 check('stale write denied',(await call('set_income_notes',{id:t.id,revision:t.revision,notes:'Stale'})).isError);
 const audit=sql("SELECT actor_type,actor_id,delegated_user_id FROM audit_events WHERE action='transaction.income_notes_updated' ORDER BY id DESC LIMIT 1")[0];check('atomic audit identifies AI on behalf Alice',audit.actor_type==='AI' && audit.actor_id===null && audit.delegated_user_id==='alice');
 sql("UPDATE mcp_grants SET scope='finance:read',scope_json='[\"finance:read\"]' WHERE client_id='fixture-ai'");check('scope downgrade denies writes',(await call('set_transaction_tag',{id:t.id,revision:t.revision+1,tag:'Denied'})).isError);
 sql("UPDATE mcp_grants SET revoked_at=1 WHERE client_id='fixture-ai'");check('revocation immediate',(await rpc('tools/list')).status===401);
 sql("UPDATE mcp_grants SET revoked_at=NULL WHERE client_id='fixture-ai'; UPDATE mcp_tokens SET expires_at=0");check('token expiry immediate',(await rpc('tools/list')).status===401);
 const settings=await (await user.get('/org/demo-jakarta/settings')).text();check('expired token not listed as active connection',!settings.includes('Your delegated connections'));
 sql("UPDATE mcp_tokens SET expires_at=9999999999999; UPDATE roles SET permissions='[]' WHERE id=(SELECT role_id FROM memberships WHERE user_id='alice' AND org_id=1)");check('membership permission change immediate',(await rpc('tools/list')).status===401);
 return failures;
}
