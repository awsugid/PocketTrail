<script lang="ts">
	import OrgShell from '$lib/components/OrgShell.svelte';
	import SettingsNav from '$lib/components/SettingsNav.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const s = $derived(data.settings);
	const slug = $derived(data.shell.org.slug);
	const base = $derived(`/org/${slug}/settings`);

	const sections = $derived(
		[
			{
				key: 'pockets',
				href: `${base}/pockets`,
				title: 'Pockets',
				body: `${s.pockets.length} pocket${s.pockets.length === 1 ? '' : 's'}. Each one needs an active owner.`,
				show: true
			},
			{
				key: 'routing',
				href: `${base}/routing`,
				title: 'Routing',
				body: `${s.mappings.length} statement-label mapping${s.mappings.length === 1 ? '' : 's'}; income notes route to a role.`,
				show: s.can.mappings || s.can.roles
			},
			{
				key: 'people',
				href: `${base}/people`,
				title: 'People',
				body: `${s.members.filter((m) => m.active).length} active member${s.members.filter((m) => m.active).length === 1 ? '' : 's'}, ${s.invitations.length} pending invitation${s.invitations.length === 1 ? '' : 's'}.`,
				show: s.can.members
			},
			{
				key: 'roles',
				href: `${base}/roles`,
				title: 'Roles',
				body: `${s.roles.length} role${s.roles.length === 1 ? '' : 's'} with per-permission control.`,
				show: s.can.roles
			},
			{
				key: 'notifications',
				href: `${base}/notifications`,
				title: 'Notifications',
				body: s.notifications.enabled
					? 'Local outbox only: no email is sent.'
					: 'Off by default. Nothing is captured or delivered.',
				show: s.can.notifications
			}
		].filter((section) => section.show)
	);
</script>

<svelte:head>
	<title>Settings · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="settings">
	<div class="page-head">
		<div>
			<h1>Settings</h1>
			<p class="lede">
				Configuration for {data.shell.org.name}, split into focused sections. Each section re-checks your
				permission when it saves.
			</p>
		</div>
	</div>

	<SettingsNav current="overview" can={s.can} slug={slug} />

	{#if s.msg}<p class="notice" role="status">{s.msg}</p>{/if}

	<ul class="section-list">
		{#each sections as section (section.key)}
			<li>
				<a href={section.href}><strong>{section.title}</strong></a>
				<span class="cell__sub">{section.body}</span>
			</li>
		{/each}
	</ul>

	{#if s.can.members}
		<section class="detail-section" aria-labelledby="audit-heading">
			<h2 id="audit-heading">Audit trail</h2>
			<p class="section-lede">Append-only record of organization changes, newest first.</p>
			{#if s.auditEvents.length === 0}
				<p class="muted">No organization events recorded yet.</p>
			{:else}
				<ul class="audit">
					{#each s.auditEvents as event (event.id)}
						<li>
							<strong>{event.actionLabel}</strong>
							<span class="cell__sub">
								{event.actorName ?? 'Unknown actor'} · {event.targetLabel} · {event.outcomeLabel} · {event.createdAtLabel}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
			{#if s.auditPage > 1 || s.auditHasMore}
				<nav class="pager" aria-label="Audit pages">
					{#if s.auditPage > 1}
						<a class="btn" href="{base}?page={s.auditPage - 1}#audit">Newer</a>
					{/if}
					{#if s.auditHasMore}
						<a class="btn" href="{base}?page={s.auditPage + 1}#audit">Older</a>
					{/if}
				</nav>
			{/if}
		</section>
	{/if}
</OrgShell>

<style>
	.section-list {
		list-style: none;
		margin: 16px 0 8px;
		padding: 0;
		display: grid;
		gap: 12px;
		max-width: 860px;
	}
	@media (min-width: 860px) {
		.section-list {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	.section-list li {
		padding: 14px 16px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-panel);
	}
	.section-list a {
		text-decoration: none;
		font-size: 15px;
	}
	.section-list a:hover {
		text-decoration: underline;
	}
	.section-lede {
		margin: 0 0 12px;
		max-width: 70ch;
		color: var(--text-secondary);
	}
	.audit {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.audit li {
		padding: 8px 0;
		border-bottom: 1px solid var(--border);
	}
</style>
