<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import OrgShell from '#lib/components/OrgShell.svelte';
	import PageHead from '#lib/components/PageHead.svelte';
	import SettingsNav from '#lib/components/SettingsNav.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let feedback = $state('');
	const claude = $derived(`claude mcp add --transport http pockettrail ${data.endpoint}`);
	const zed = $derived(JSON.stringify({ context_servers: { pockettrail: { url: data.endpoint } } }, null, 2));
	async function copy(text: string, name: string) {
		try {
			await navigator.clipboard.writeText(text);
			feedback = `${name} copied`;
		} catch {
			feedback = 'Copy failed. Select and copy the text manually.';
		}
	}
</script>

<svelte:head><title>AI clients · {data.shell.org.name}</title></svelte:head>

<OrgShell {...data.shell} active="settings">
	<PageHead title="AI clients" icon="settings" />
	<SettingsNav current="ai-clients" can={data.settings.can} slug={data.shell.org.slug} />
	<div class="stack">
		<section class="panel" aria-labelledby="connect-heading">
			<div class="panel__head"><h2 id="connect-heading">Connect an AI client</h2></div>
			<div class="panel__body stack">
				<p>Your client acts as you, limited to your role permissions. You approve access on a consent screen and can revoke it any time.</p>
				<div class="field">
					<Label for="mcp-endpoint">MCP server URL</Label>
					<div class="flex items-center gap-2"><Input id="mcp-endpoint" readonly value={data.endpoint} /><Button variant="outline" onclick={() => copy(data.endpoint, 'Server URL')}>{feedback === 'Server URL copied' ? 'Copied' : 'Copy'}</Button></div>
				</div>
				{#each [{ name: 'Claude Code', code: claude }, { name: 'Zed', code: zed }] as client}
					<div class="stack gap-2">
						<div class="flex items-center justify-between gap-2"><h3>{client.name}</h3><Button variant="outline" size="sm" aria-label={`Copy ${client.name} configuration`} onclick={() => copy(client.code, client.name)}>{feedback === `${client.name} copied` ? 'Copied' : 'Copy'}</Button></div>
						{#if client.name === 'Zed'}<p>Add to <code>settings.json</code>:</p>{/if}
						<pre class="overflow-x-auto rounded-lg bg-muted p-4 text-sm"><code>{client.code}</code></pre>
						{#if client.name === 'Claude Code'}<p>Then run <code>/mcp</code> to sign in.</p>{/if}
					</div>
				{/each}
				<p class="break-words">Other MCP clients: add <code>{data.endpoint}</code> as a remote HTTP server; sign in when prompted.</p>
				<p role="status" class="hint">{feedback}</p>
			</div>
		</section>
		<section class="panel" aria-labelledby="clients-heading">
			<div class="panel__head"><h2 id="clients-heading">Connected clients</h2></div>
			{#if data.grants.length}
				<ul class="rows">{#each data.grants as grant (grant.id)}
					<li><span class="rows__main"><strong class="break-all">{grant.client_id}</strong><span class="rows__sub">{grant.scope}</span></span>
						<form method="POST" action="?/revokeMcp" use:enhance><input type="hidden" name="csrf_token" value={data.shell.csrfToken} /><input type="hidden" name="grant_id" value={grant.id} /><Button type="submit" variant="outline" size="sm">Revoke access</Button></form>
					</li>
				{/each}</ul>
			{:else}<p class="panel__body">No connected clients yet.</p>{/if}
		</section>
	</div>
</OrgShell>
