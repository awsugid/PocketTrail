import {it,expect} from 'vitest';
import {oauthClients,authorizationRequest} from '../src/lib/server/mcp_oauth';
import {readFileSync} from 'node:fs';
it('private exact redirect allowlist accepts legitimate multiple callbacks, rejects unsafe metadata',async()=>{
 const client={clientId:'test',name:'Trusted',redirectUris:['https://client.example/callback','https://client.example/alternate'],scopes:['finance:read']};
 expect(oauthClients(JSON.stringify([client]))).toHaveLength(1);
 for(const uri of ['http://evil.example/cb','https://user:pass@client.example/cb','https://client.example/cb#fragment'])expect(oauthClients(JSON.stringify([{...client,redirectUris:[uri]}]))).toEqual([]);
 for(const uri of client.redirectUris){const url=new URL('https://finance.example/oauth/authorize');for(const[k,v]of Object.entries({client_id:'test',redirect_uri:uri,response_type:'code',resource:'https://finance.example/mcp',state:'s'.repeat(20),code_challenge:'c'.repeat(43),code_challenge_method:'S256'}))url.searchParams.set(k,v);expect((await authorizationRequest({url,platform:{env:{MCP_OAUTH_CLIENTS:JSON.stringify([client])}}} as any)).redirectUri).toBe(uri);}
 const source=readFileSync(new URL('../src/routes/oauth/authorize/+page.svelte',import.meta.url),'utf8');expect(source).toContain('value="deny" formnovalidate');expect(source).toContain('data.clientId');expect(source).toContain('data.callback');
});
