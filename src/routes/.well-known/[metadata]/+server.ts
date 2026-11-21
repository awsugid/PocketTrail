import {json,error} from '@sveltejs/kit';
import {MCP_SCOPES} from '$lib/server/mcp_oauth';
import type {RequestHandler} from './$types';
export const GET:RequestHandler=({params,url})=>{
 const origin=url.origin;
 const data=params.metadata==='oauth-protected-resource'?{resource:origin+'/mcp',authorization_servers:[origin],scopes_supported:MCP_SCOPES,bearer_methods_supported:['header']}:
 params.metadata==='oauth-authorization-server'?{issuer:origin,authorization_endpoint:origin+'/oauth/authorize',token_endpoint:origin+'/oauth/token',response_types_supported:['code'],grant_types_supported:['authorization_code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],scopes_supported:MCP_SCOPES}:null;
 if(!data)throw error(404);
 return json(data,{headers:{'access-control-allow-origin':'*'}});
};
