<script lang="ts">
	import OrgShell from '$lib/components/OrgShell.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const slug = $derived(data.shell.org.slug);
	const empty = $derived(data.explain.length === 0 && data.review.length === 0 && data.imports.length === 0);
</script>

<OrgShell {...data.shell} active="actions">
	<div class="page-head">
		<div>
			<h1>Actions</h1>
			<p class="lede">Your documentation tasks, reviews waiting on you, and imports in progress. The ledger keeps every record regardless.</p>
		</div>
	</div>

	{#if empty}
		<div class="empty-state">
			<p>Nothing is waiting on you right now.</p>
			<p class="muted">
				This does not mean the ledger is empty — <a href="/org/{slug}/transactions">browse all transactions</a> to see everything.
				{#if !data.canImport}
					Importing statements is done by members with import permission.
				{/if}
			</p>
		</div>
	{:else}
		{#if data.explain.length > 0}
			<section class="task-group">
				<h2>Explanations you owe <span class="count-badge">{data.explain.length}</span></h2>
				<ul class="task-list">
					{#each data.explain as task (task.id)}
						<li>
							<a href="/org/{slug}/transactions/{task.id}">
								<span class="task-title">{task.counterparty}</span>
								<span class="cell__sub">{task.date} · {task.pocketName} · {task.income ? 'income notes needed' : 'explanation needed'}</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if data.review.length > 0}
			<section class="task-group">
				<h2>Ready for your review <span class="count-badge">{data.review.length}</span></h2>
				<ul class="task-list">
					{#each data.review as task (task.id)}
						<li>
							<a href="/org/{slug}/transactions/{task.id}">
								<span class="task-title">{task.counterparty}</span>
								<span class="cell__sub">{task.date} · {task.pocketName} · awaiting review</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if data.imports.length > 0}
			<section class="task-group">
				<h2>Imports in progress <span class="count-badge">{data.imports.length}</span></h2>
				<ul class="task-list">
					{#each data.imports as batch (batch.id)}
						<li>
							<a href="/org/{slug}/imports/{batch.id}">
								<span class="task-title">{batch.filename || 'Statement import'}</span>
								<span class="cell__sub">{batch.status === 'ready' ? 'ready to confirm' : batch.status}</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</OrgShell>

<style>
	.task-group {
		margin: 0 0 24px;
	}
	.task-group h2 {
		font-size: 18px;
		margin: 0 0 10px;
	}
	.count-badge {
		display: inline-block;
		min-width: 22px;
		padding: 1px 7px;
		margin-left: 6px;
		border-radius: 10px;
		background: var(--neutral-bg);
		color: var(--text-secondary);
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}
	.task-list {
		list-style: none;
		margin: 0;
		padding: 0;
		max-width: 760px;
	}
	.task-list li {
		border-bottom: 1px solid var(--border);
	}
	.task-list a {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px 8px;
		text-decoration: none;
		color: var(--text);
		border-radius: var(--radius-control);
	}
	.task-list a:hover {
		background: var(--surface-2);
	}
	.task-title {
		font-weight: 600;
	}
</style>
