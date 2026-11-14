<script lang="ts">
	import Empty from '$lib/components/Empty.svelte';
	import Icon, { type IconName } from '$lib/components/Icon.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
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
		status?: string;
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
					status: `${s.pockets.length}`,
					flag: noOwner > 0 ? { tone: 'needs', text: `${noOwner} without owner` } : undefined,
					show: true
				},
				{
					key: 'routing',
					href: `${base}/routing`,
					title: 'Routing',
					icon: 'routing',
					status: `${s.mappings.length} mapping${s.mappings.length === 1 ? '' : 's'} · income → ${incomeRole ?? 'pocket owner'}`,
					show: s.can.mappings || s.can.roles
				},
				{
					key: 'people',
					href: `${base}/people`,
					title: 'People',
					icon: 'people',
					status: `${activeMembers} active`,
					flag: s.invitations.length > 0 ? { tone: 'review', text: `${s.invitations.length} invited` } : undefined,
					show: s.can.members
				},
				{
					key: 'roles',
					href: `${base}/roles`,
					title: 'Roles',
					icon: 'roles',
					status: `${s.roles.length}`,
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

	{#if s.msg}<Notice tone="success">{s.msg}</Notice>{/if}

	<div class="stack">
		<nav class="panel" aria-label="Settings sections">
			<ul class="rows rows--link">
				{#each rows as row (row.key)}
					<li>
						<a href={row.href}>
							<Icon name={row.icon} class="lead" />
							<span class="rows__main"><strong>{row.title}</strong></span>
							{#if row.flag}<span class="badge badge--{row.flag.tone}">{row.flag.text}</span>{/if}
							{#if row.status}<span class="count">{row.status}</span>{/if}
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
