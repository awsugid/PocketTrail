import { json } from '@sveltejs/kit';
import { MCP_SCOPES } from '$lib/server/mcp_oauth';
import type { RequestHandler } from './$types';
export const GET:RequestHandler=({url})=>json({resource:url.origin+'/mcp',authorization_servers:[url.origin],scopes_supported:MCP_SCOPES,bearer_methods_supported:['header']},{headers:{'access-control-allow-origin':'*'}});
