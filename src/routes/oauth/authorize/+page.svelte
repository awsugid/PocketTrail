<script lang="ts">
 import type {PageData} from './$types';
 let {data}:{data:PageData}=$props();
</script>
<svelte:head><title>Connect AI client · PocketTrail</title></svelte:head>
<main class="consent stack">
 <h1>Connect {data.clientName}</h1>
 <p>Signed in as <strong>{data.userName}</strong>. This AI client acts on your behalf, never as a direct human action.</p>
 <section class="panel"><div class="panel__body stack">
 <dl><dt>Registered client ID</dt><dd>{data.clientId}</dd><dt>Callback origin</dt><dd>{data.callbackOrigin}</dd><dt>Exact callback URL</dt><dd>{data.callback}</dd></dl>
 <p class="hint">Client metadata is registered by PocketTrail administrators. Continue only if you trust this client and callback.</p>
 <h2>Requested access</h2>
 <ul>{#each data.scopes as scope}<li>{scope==='finance:read'?'Read transaction summaries and details':scope==='income:write'?'Update income notes':'Add or remove transaction tags'}</li>{/each}</ul>
 <p class="hint">No approval, historical exemption, membership or payment access. Access expires after 15 minutes and can be revoked in Settings.</p>
 <form method="POST" class="form">
 <input type="hidden" name="csrf_token" value={data.csrf}/>
 <div class="field"><label for="organization">Organization</label><select class="input" id="organization" name="org_slug" required>{#each data.organizations as org}<option value={org.slug}>{org.name}</option>{/each}</select></div>
 <div class="form-actions"><button class="btn" name="decision" value="deny" formnovalidate>Cancel</button><button class="btn btn--primary" name="decision" value="allow">Allow access</button></div>
 </form>
 </div></section>
</main>
<style>.consent{max-width:600px;margin:48px auto;padding:0 20px;}dd{margin:4px 0 12px;overflow-wrap:anywhere;}dt{font-weight:600;}</style>
