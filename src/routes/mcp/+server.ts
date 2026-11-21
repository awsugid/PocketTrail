import { error, json } from '@sveltejs/kit';
import { bindings } from '$lib/server/auth';
import { mcpMessage, rpcError, MCP_VERSION, validInitialize } from '$lib/server/mcp';
import { qOne, exec, nowMs } from '$lib/server/db';
import type { RequestHandler } from './$types';

import { delegatedCredential } from '$lib/server/mcp_oauth';
async function credentialFor(event:Parameters<RequestHandler>[0]) {
 if(event.url.protocol!=='https:' && !['127.0.0.1','localhost'].includes(event.url.hostname))throw error(403,'HTTPS required.');
 const origin=event.request.headers.get('origin');if(origin && origin!==event.url.origin)throw error(403,'Untrusted MCP Origin.');
 return delegatedCredential(event);
}
const unauthorized=(url:URL)=>json({error:'unauthorized'},{status:401,headers:{'WWW-Authenticate':`Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource", scope="finance:read"`}});
export const POST: RequestHandler = async (event) => {
 const {request,url,platform}=event;
 const env=bindings(platform),credential=await credentialFor(event);
 if(!credential)return unauthorized(url);
 const version=request.headers.get('mcp-protocol-version');
 if(version && version!==MCP_VERSION) throw error(400,'Unsupported MCP protocol version.');
 if(!request.headers.get('content-type')?.startsWith('application/json')) throw error(415,'JSON required.');
 const accept=request.headers.get('accept') ?? '';
 if(!accept.includes('application/json') || !accept.includes('text/event-stream')) throw error(406,'Accept application/json and text/event-stream required.');
 if(Number(request.headers.get('content-length'))>16384) throw error(413,'MCP message too large.');
 const reader=request.body?.getReader();
 let text='',size=0;
 if(reader) {
 const decoder=new TextDecoder();
 for(;;) { const {value,done}=await reader.read(); if(done) break; size+=value.byteLength; if(size>16384){await reader.cancel();throw error(413,'MCP message too large.');} text+=decoder.decode(value,{stream:true}); }
 text+=decoder.decode();
 }
 let body:any;
 try{body=JSON.parse(text);}catch{return json(rpcError(null,-32700,'Parse error'),{status:400});}
 if(!body || typeof body!=='object' || Array.isArray(body) || body.jsonrpc!=='2.0' || typeof body.method!=='string' || ('id' in body && typeof body.id!=='string' && (typeof body.id!=='number' || !Number.isSafeInteger(body.id)))) return json(rpcError(null,-32600,'Invalid Request'),{status:400});
 if(body.method==='initialize') {
 const response=await mcpMessage(env.DB,credential,body);
 if(!validInitialize(body.params) || body.id===undefined) return json(response ?? rpcError(null,-32600,'Initialization requires request ID'),{status:400});
 const session=crypto.randomUUID();
 await exec(env.DB,'INSERT INTO mcp_sessions(id,credential_hash,expires_at) VALUES(?1,?2,?3)',[session,credential.tokenHash,Math.min(credential.expiresAt,nowMs()+3600000)]);
 return json(response,{headers:{'Mcp-Session-Id':session}});
 }
 const sessionId=request.headers.get('mcp-session-id');
 if(!sessionId) return json(rpcError(body.id ?? null,-32000,'Initialize session first'),{status:400});
 const session=await qOne<{initialized:number}>(env.DB,'SELECT initialized FROM mcp_sessions WHERE id=?1 AND credential_hash=?2 AND expires_at>?3',[sessionId,credential.tokenHash,nowMs()]);
 if(!session) throw error(404,'MCP session expired or unknown.');
 if(version!==MCP_VERSION) throw error(400,'Negotiated MCP protocol version required.');
 if(body.method==='notifications/initialized' && body.id===undefined) {
 await exec(env.DB,'UPDATE mcp_sessions SET initialized=1 WHERE id=?1 AND credential_hash=?2',[sessionId,credential.tokenHash]);
 return new Response(null,{status:202});
 }
 if(!session.initialized && body.method!=='ping') return json(rpcError(body.id ?? null,-32000,'Initialization not completed'),{status:400});
 const response=await mcpMessage(env.DB,credential,body,event);
 return response===null ? new Response(null,{status:202}) : json(response);
};
export const GET: RequestHandler = async (event) => {
 if(!await credentialFor(event))return unauthorized(event.url);
 return new Response(null,{status:405,headers:{Allow:'POST, DELETE'}});
};
export const DELETE: RequestHandler = async (event) => {
 const {request,platform}=event;const env=bindings(platform),credential=await credentialFor(event);
 if(!credential)return unauthorized(event.url);
 const id=request.headers.get('mcp-session-id');
 if(!id) throw error(400,'MCP session required.');
 await exec(env.DB,'DELETE FROM mcp_sessions WHERE id=?1 AND credential_hash=?2',[id,credential.tokenHash]);
 return new Response(null,{status:204});
};
