import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {withWorker,Client,ORIGIN,extractCsrf} from '../e2e/harness.mjs';
await withWorker(async()=>{
 const resource=await (await fetch(ORIGIN+'/.well-known/oauth-protected-resource')).json();assert.equal(resource.resource,ORIGIN+'/mcp');
  const scopes=['finance:read','purposes:read','income:write','tags:write','purposes:write'];assert.deepEqual(resource.scopes_supported,scopes);
  const unauthorized=await fetch(resource.resource);assert.equal(unauthorized.status,401);assert(unauthorized.headers.get('www-authenticate').includes('scope="'+scopes.join(' ')+'"'));console.log('PASS all-scope challenge + metadata');
 const metadata=await (await fetch(ORIGIN+'/.well-known/oauth-authorization-server')).json();assert.equal(metadata.client_id_metadata_document_supported,true);assert(metadata.grant_types_supported.includes('refresh_token'));console.log('PASS discovery: resource, CIMD, refresh_token');
 const client=new Client();let page=await client.get('/login');let csrf=extractCsrf(await page.text());assert(csrf);
 assert.equal((await client.postForm('/login?/dev',{csrf_token:csrf,user_id:'alice'})).status,303);
 const verifier=randomBytes(32).toString('base64url'),url=new URL(metadata.authorization_endpoint);
 for(const [key,value]of Object.entries({client_id:'fixture-ai',redirect_uri:'https://client.example.test/callback',response_type:'code',resource:resource.resource,scope:'finance:read',state:randomBytes(24).toString('base64url'),code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}))url.searchParams.set(key,value);
 page=await client.get(url.pathname+url.search);const html=await page.text();assert.equal(page.status,200);csrf=extractCsrf(html);assert(csrf);
 const consent=await client.postForm(url.pathname+url.search,{csrf_token:csrf,org_slug:'demo-jakarta',decision:'allow'});assert.equal(consent.status,303);const code=new URL(consent.headers.get('location')).searchParams.get('code');assert(code);console.log('PASS authenticated consent + PKCE code');
 async function token(fields){const response=await fetch(metadata.token_endpoint,{method:'POST',body:new URLSearchParams({client_id:'fixture-ai',resource:resource.resource,...fields})});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;}
 let tokens=await token({grant_type:'authorization_code',code,redirect_uri:'https://client.example.test/callback',code_verifier:verifier});let sid='';
 async function rpc(method,params){const response=await fetch(resource.resource,{method:'POST',headers:{authorization:'Bearer '+tokens.access_token,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25',...(sid?{'mcp-session-id':sid}:{})},body:JSON.stringify({jsonrpc:'2.0',...(method.startsWith('notifications/')?{}:{id:1}),method,params})});assert(response.ok,await response.clone().text());if(method==='initialize')sid=response.headers.get('mcp-session-id');return response.status===202?null:response.json();}
 async function init(){await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'OAuth test',version:'1'}});await rpc('notifications/initialized');}
 await init();const tools=(await rpc('tools/list')).result.tools;assert(tools.some(t=>t.name==='list_transactions'));console.log('PASS initialize + tools/list:',tools.map(t=>t.name).join(', '));
 const outputs={};
  for(const name of ['finance_summary','list_transactions']){const response=await rpc('tools/call',{name,arguments:{}});assert.equal(response.result.isError,false);outputs[name]=JSON.parse(response.result.content[0].text).data;console.log('PASS tools/call '+name);}
  assert.deepEqual(outputs.finance_summary,outputs.list_transactions.summary);
  for(const row of outputs.list_transactions.entries){assert(row.amountMinor>=0);assert(['in','out'].includes(row.direction));}
  const missing=await rpc('tools/call',{name:'transaction_details',arguments:{id:999999999}});assert.equal(missing.result.isError,true);assert.equal(missing.result.content[0].text,'Transaction not found');console.log('PASS summary parity + magnitudes + missing detail');
 tokens=await token({grant_type:'refresh_token',refresh_token:tokens.refresh_token});assert.equal((await rpc('tools/call',{name:'finance_summary',arguments:{}})).result.isError,false);console.log('PASS refresh rotation + existing session + finance_summary');
 const inspector=spawnSync('npx',['--yes','@modelcontextprotocol/inspector','--cli',resource.resource,'--transport','http','--header','Authorization: Bearer '+tokens.access_token,'--method','tools/list'],{encoding:'utf8',timeout:90000});console.log('Inspector exit:',inspector.status);console.log(inspector.stdout);console.log(inspector.stderr);
});
