<script lang="ts">
	import Empty from '$lib/components/Empty.svelte';
	import Icon, { type IconName } from '$lib/components/Icon.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const slug = $derived(data.shell.org.slug);
	const empty = $derived(data.explain.length === 0 && data.review.length === 0 && data.imports.length === 0);

	const groups = $derived<
		Array<{ key: string; title: string; icon: IconName; rows: Array<{ href: string; title: string; sub: string; badge: string; tone: string }> }>
	>([
		{
			key: 'explain',
			title: 'To explain',
			icon: 'comment',
			rows: data.explain.map((task) => ({
				href: `/org/${slug}/transactions/${task.id}`,
				title: task.counterparty,
				sub: `${task.date} · ${task.pocketName}`,
				badge: task.income ? 'Income notes' : 'Explanation',
				tone: 'needs'
			}))
		},
		{
			key: 'review',
			title: 'To review',
			icon: 'check',
			rows: data.review.map((task) => ({
				href: `/org/${slug}/transactions/${task.id}`,
				title: task.counterparty,
				sub: `${task.date} · ${task.pocketName}`,
				badge: 'Awaiting review',
				tone: 'review'
			}))
		},
		{
			key: 'imports',
			title: 'Imports',
			icon: 'imports',
			rows: data.imports.map((batch) => ({
				href: `/org/${slug}/imports/${batch.id}`,
				title: batch.filename || 'Statement import',
				sub: `Batch #${batch.id}`,
				badge: batch.status === 'ready' ? 'Ready to confirm' : batch.status,
				tone: 'info'
			}))
		}
	]);
</script>

<svelte:head>
	<title>Actions · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="actions">
	<PageHead title="Actions" icon="actions" />

	{#if empty}
		<div class="panel">
			<Empty icon="check" title="All clear">
				<a class="btn" href="/org/{slug}/transactions"><Icon name="ledger" size={16} />Open ledger</a>
			</Empty>
		</div>
	{:else}
		<div class="stack">
			{#each groups.filter((group) => group.rows.length > 0) as group (group.key)}
				<section class="panel" aria-labelledby="{group.key}-heading">
					<div class="panel__head">
						<Icon name={group.icon} size={16} /><h2 id="{group.key}-heading">{group.title}</h2>
						<span class="count">{group.rows.length}</span>
					</div>
					<ul class="rows rows--link">
						{#each group.rows as row (row.href)}
							<li>
								<a href={row.href}>
									<span class="rows__main">
										<strong>{row.title}</strong>
										<span class="rows__sub">{row.sub}</span>
									</span>
									<span class="badge badge--{row.tone}">{row.badge}</span>
									<Icon name="chevron" size={16} class="tail" />
								</a>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}
</OrgShell>
