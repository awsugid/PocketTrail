<script lang="ts">
 import {Button} from '$lib/components/ui/button';
  import {Label} from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
  import type {PageData} from './$types';
 let {data}:{data:PageData}=$props();
  let organization=$state('');
</script>
<svelte:head><title>Connect AI client · PocketTrail</title></svelte:head>
<main class="consent flex flex-col gap-5">
 <h1>Connect {data.clientName}</h1>
  {#if data.clientHost}<p>Client host: <strong>{data.clientHost}</strong></p>{/if}
 <p class="my-[14px]">Signed in as <strong>{data.userName}</strong>. This AI client acts on your behalf, never as a direct human action.</p>
 <section class="rounded-lg border p-5"><div class="flex flex-col gap-4">
 <dl class="my-[14px]"><dt>Registered client ID</dt><dd>{data.clientId}</dd><dt>Callback origin</dt><dd>{data.callbackOrigin}</dd><dt>Exact callback URL</dt><dd>{data.callback}</dd></dl>
 <p class="hint">Client names are self-reported. Verify client host and callback before granting access.</p>
 <h2>Requested access</h2>
 <ul class="my-[14px] list-disc pl-10">{#each data.scopes as scope}<li>{scope==='finance:read'?'Read transaction summaries and details':scope==='income:write'?'Update income notes':scope==='purposes:read'?'Read purposes and details':scope==='purposes:write'?'Allocate transactions and review purposes when your role permits':'Add or remove transaction tags'}</li>{/each}</ul>
 <p class="hint">Your current role permissions limit every call. Purpose reviews require your approval permission; reviewing your own responsibilities stays forbidden. No membership or payment access. Access tokens last 15 minutes; refresh access lasts up to 30 days between uses, at most 90 days total. Revoke anytime in Settings.</p>
 <form method="POST" class="form">
 <input type="hidden" name="csrf_token" value={data.csrf}/>
 <div class="field"><Label for="organization">Organization</Label><Select.Root type="single" name="org_slug" bind:value={organization} required><Select.Trigger id="organization">{data.organizations.find(org=>org.slug===organization)?.name ?? 'Select organization'}</Select.Trigger><Select.Content>{#each data.organizations as org}<Select.Item value={org.slug} label={org.name}>{org.name}</Select.Item>{/each}</Select.Content></Select.Root></div>
 <div class="form-actions"><Button type="submit" variant="outline" name="decision" value="deny" formnovalidate>Cancel</Button><Button type="submit" name="decision" value="allow">Allow access</Button></div>
 </form>
 </div></section>
</main>
<style>.consent{max-width:600px;margin:48px auto;padding:0 20px;}dd{margin:4px 0 12px;overflow-wrap:anywhere;}dt{font-weight:600;}</style>
