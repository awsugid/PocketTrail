import {it,expect} from 'vitest';
import {resolveOAuthClient,redirectMatches,validMetadataUrl} from '../src/lib/server/mcp_oauth';
const id='https://client.example/metadata.json';
const doc={client_id:id,client_name:'Client',redirect_uris:['http://127.0.0.1/callback'],token_endpoint_auth_method:'none'};
it('validates CIMD identity and public-client metadata',async()=>{
 const fetcher=(value:unknown)=>async()=>new Response(JSON.stringify(value),{headers:{'cache-control':'no-store'}});
 expect((await resolveOAuthClient(id,undefined,fetcher(doc) as typeof fetch))?.name).toBe('Client');
 for(const value of [{...doc,client_id:id+'x'},{...doc,redirect_uris:['http://evil.example/callback']},{...doc,token_endpoint_auth_method:'client_secret_basic'},{...doc,client_name:''}])expect(await resolveOAuthClient(id,undefined,fetcher(value) as typeof fetch)).toBeNull();
 expect(await resolveOAuthClient(id,undefined,fetcher({...doc,padding:'x'.repeat(5120)}) as typeof fetch)).toBeNull();
});
it('rejects failed fetches and redirects without following them',async()=>{
 let options:RequestInit|undefined;
 expect(await resolveOAuthClient(id,undefined,(async(_url,init)=>{options=init;throw new Error('redirect');}) as typeof fetch)).toBeNull();
 expect(options?.redirect).toBe('error');expect(options?.signal).toBeInstanceOf(AbortSignal);
 expect(await resolveOAuthClient(id,undefined,(async()=>new Response('{}',{status:500})) as typeof fetch)).toBeNull();
});
it('blocks non-HTTPS, private, local and IPv6 metadata URLs',()=>{
 for(const host of ['http://client.example/doc','https://localhost/doc','https://foo.localhost/doc','https://127.0.0.1/doc','https://10.1.2.3/doc','https://172.16.0.1/doc','https://192.168.0.1/doc','https://169.254.169.254/doc','https://[::1]/doc','https://[::ffff:127.0.0.1]/doc','https://client.example/'])expect(validMetadataUrl(host),host).toBe(false);
});
it('ignores only loopback port; preserves host, scheme, path and query',()=>{
 for(const host of ['127.0.0.1','[::1]','localhost'])expect(redirectMatches(`http://${host}:123/callback?a=1`,`http://${host}:987/callback?a=1`)).toBe(true);
 for(const uri of ['http://localhost:987/callback?a=1','https://127.0.0.1:987/callback?a=1','http://127.0.0.1:987/other?a=1','http://127.0.0.1:987/callback?a=2'])expect(redirectMatches('http://127.0.0.1:123/callback?a=1',uri)).toBe(false);
 expect(redirectMatches('https://client.example:123/callback','https://client.example:987/callback')).toBe(false);
});
