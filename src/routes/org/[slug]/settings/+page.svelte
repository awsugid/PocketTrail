<script lang="ts">
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import Empty from '#lib/components/Empty.svelte';
	import Icon, { type IconName } from '#lib/components/Icon.svelte';
	import Notice from '#lib/components/Notice.svelte';
	import OrgShell from '#lib/components/OrgShell.svelte';
	import PageHead from '#lib/components/PageHead.svelte';
	import SettingsNav from '#lib/components/SettingsNav.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const s = $derived(data.settings);
	const slug = $derived(data.shell.org.slug);
	const base = $derived(`/org/${slug}/settings`);

	const noOwner = $derived(s.pockets.filter((pocket) => pocket.ownerName === null).length);
	const activeMembers = $derived(s.members.filter((member) => member.active).length);
	const incomeRole = $derived(s.roles.find((role) => role.id === s.incomeExplanationRoleId)?.name ?? null);

	interface Row {
		key: string;
		href: string;
		title: string;
		icon: IconName;
		/** Short count shown at the row's right edge. */
		count?: string;
		/** Longer facts shown under the title. */
		detail?: string;
		flag?: { tone: string; text: string };
	}

	const rows = $derived<Row[]>(
		(
			[
				{
					key: 'pockets',
					href: `${base}/pockets`,
					title: 'Pockets',
					icon: 'pocket',
					count: `${s.pockets.length}`,
					flag: noOwner > 0 ? { tone: 'needs', text: `${noOwner} without owner` } : undefined,
					show: true
				},
				{
					key: 'routing',
					href: `${base}/routing`,
					title: 'Routing',
					icon: 'routing',
					count: `${s.mappings.length}`,
					detail: `Income notes → ${incomeRole ?? 'pocket owners'}`,
					show: s.can.mappings || s.can.roles
				},
				{
					key: 'people',
					href: `${base}/people`,
					title: 'People',
					icon: 'people',
					count: `${activeMembers} active`,
					flag: s.invitations.length > 0 ? { tone: 'review', text: `${s.invitations.length} invited` } : undefined,
					show: s.can.members
				},
				{
					key: 'roles',
					href: `${base}/roles`,
					title: 'Roles',
					icon: 'roles',
					count: `${s.roles.length}`,
					show: s.can.roles
				},
				{
					key: 'notifications',
					href: `${base}/notifications`,
					title: 'Notifications',
					icon: 'bell',
					flag: s.notifications.enabled ? { tone: 'approved', text: 'On' } : { tone: 'muted', text: 'Off' },
					show: s.can.notifications
				}
			] as Array<Row & { show: boolean }>
		).filter((row) => row.show)
	);
</script>

<svelte:head>
	<title>Settings · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="settings">
	<PageHead title="Settings" icon="settings" />
	<SettingsNav current="overview" can={s.can} slug={slug} />

	{#if s.msg}<Notice tone="success">{s.msg}</Notice>{/if}

	<div class="stack">
	<section class="panel mcp-section" aria-labelledby="mcp-heading">
		<div class="panel__head"><Icon name="settings" size={16}/><h2 id="mcp-heading">MCP · AI connections</h2><span class="badge badge--muted">{data.mcp.configured?'OAuth available':'Client setup needed'}</span></div>
		<div class="panel__body stack">
			<p class="my-[14px]">Connect an AI client using your existing Google sign-in. Choose one organization and approve requested access. Activity is labeled <strong>AI on behalf of you</strong>.</p>
			<div class="field"><Label for="mcp-endpoint">MCP server URL</Label><Input class="" id="mcp-endpoint" readonly value={data.mcp.endpoint}/></div>
			<p class="hint">Supports summaries, transaction details, income notes and tags. Writes require explicit consent and your current documentation permission. No approvals, exemptions, payments or member management.</p>
			<details class="fold"><summary>How to connect</summary><ol class="stack my-[14px] list-decimal pl-10"><li>Add this server URL to your client's MCP connector and choose OAuth.</li><li>Sign in with Google on PocketTrail, choose this organization, and review requested access.</li><li>Allow access only for a client you trust. Tokens expire after 15 minutes; reconnect when needed.</li></ol>{#if !data.mcp.configured}<p class="hint">Administrator must first register the client's exact callback URL and allowed scopes. No client is enabled yet; this URL alone grants no access.</p>{/if}</details>
			{#if data.mcp.grants.length}<h3>Your delegated connections</h3><ul class="rows">{#each data.mcp.grants as grant}<li><span class="rows__main"><strong>{grant.client_id}</strong><span class="rows__sub">{grant.scope}</span></span><form method="POST" action="?/revokeMcp"><input type="hidden" name="csrf_token" value={data.shell.csrfToken}/><input type="hidden" name="grant_id" value={grant.id}/><Button class="" type="submit" variant="outline" size="sm">Revoke access</Button></form></li>{/each}</ul>{/if}
		</div>
	</section>

		<nav class="panel" aria-label="Settings status">
			<ul class="rows rows--link">
				{#each rows as row (row.key)}
					<li>
						<a href={row.href}>
							<Icon name={row.icon} class="lead" />
							<span class="rows__main"><strong>{row.title}</strong>{#if row.detail}<span class="rows__sub">{row.detail}</span>{/if}</span>
							{#if row.flag}<span class="badge badge--{row.flag.tone}">{row.flag.text}</span>{/if}
							{#if row.count}<span class="count">{row.count}</span>{/if}
							<Icon name="chevron" size={16} class="tail" />
						</a>
					</li>
				{/each}
			</ul>
		</nav>

		{#if s.can.members}
			<section class="panel" aria-labelledby="audit-heading" id="audit">
				<div class="panel__head"><Icon name="history" size={16} /><h2 id="audit-heading">Audit trail</h2></div>
				{#if s.auditEvents.length === 0}
					<Empty icon="history" title="No events yet" inline />
				{:else}
					<ul class="rows">
						{#each s.auditEvents as event (event.id)}
							<li>
								<div class="rows__main">
									<strong>{event.actionLabel}</strong>
									<span class="rows__sub">{event.actorName ?? 'Unknown'} · {event.targetLabel} · {event.outcomeLabel}</span>
								</div>
								<span class="count">{event.createdAtLabel}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
			{#if s.auditPage > 1 || s.auditHasMore}
				<nav class="pager" aria-label="Audit pages">
					{#if s.auditPage > 1}
						<a class="btn" href="{base}?page={s.auditPage - 1}#audit"><Icon name="back" size={16} />Newer</a>
					{/if}
					{#if s.auditHasMore}
						<a class="btn" href="{base}?page={s.auditPage + 1}#audit">Older<Icon name="next" size={16} /></a>
					{/if}
				</nav>
			{/if}
		{/if}
	</div>

</OrgShell>
<style>.mcp-section .panel__head{flex-wrap:wrap;}.mcp-section p,.mcp-section li{overflow-wrap:anywhere;}</style>
