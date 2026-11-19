<script lang="ts">
	import Empty from '$lib/components/Empty.svelte';
	import Icon, { type IconName } from '$lib/components/Icon.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { submit, unsavedGuard } from '$lib/forms';
	import { stack } from '$lib/table';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const slug = $derived(data.shell.org.slug);
	const base = $derived(`/org/${slug}/purposes`);
	const statusIcons: Record<string, IconName> = { needs: 'alert', review: 'history', approved: 'check', changes: 'close' };

	const filters = [
		{ value: 'all', label: 'All purposes' },
		{ value: 'expense', label: 'Expense' },
		{ value: 'income', label: 'Income' }
	];
	const href = (kind: string) => (kind === 'all' ? base : `${base}?kind=${kind}`);

	let kind = $state('expense');
</script>

<svelte:head>
	<title>Purposes · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="purposes">
	<PageHead title="Purposes" icon="tag">
		{#snippet actions()}
			<span class="count">{data.entries.length} total</span>
		{/snippet}
	</PageHead>

	<div class="toolbar">
		<nav class="chips" aria-label="Purpose kind filter">
			{#each filters as option (option.value)}
				<a class="chip" href={href(option.value)} aria-current={(data.kind ?? 'all') === option.value ? 'true' : undefined}>
					{option.label}
				</a>
			{/each}
		</nav>
	</div>

	{#if data.canCreate}
		<section class="panel" aria-labelledby="new-purpose-heading">
			<div class="panel__head">
				<Icon name="plus" size={16} />
				<h2 id="new-purpose-heading">New purpose</h2>
			</div>
			<div class="panel__body">
				<form method="POST" action="?/create" class="form form--inline" use:submit use:unsavedGuard>
					<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
					<div class="field">
						<label for="purpose-name">Name</label>
						<input class="input" id="purpose-name" name="name" required maxlength="300" placeholder="Food for June meetup" />
					</div>
					<div class="field">
						<label for="purpose-kind">Records</label>
						<Select id="purpose-kind" name="kind" items={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]} bind:value={kind} required />
					</div>
					<button class="btn btn--primary" type="submit"><Icon name="plus" size={16} />Add purpose</button>
				</form>
			</div>
		</section>
	{/if}

	{#if data.entries.length > 0}
		<div class="panel">
			<div class="table-scroll">
				<table class="ledger stack" use:stack>
					<caption class="visually-hidden">Purposes with total allocated, status, and responsible members</caption>
					<thead>
						<tr>
							<th scope="col">Purpose</th>
							<th scope="col" class="cell--num">Total allocated</th>
							<th scope="col" class="cell--num">Transactions</th>
							<th scope="col">Status</th>
							<th scope="col">Responsible</th>
						</tr>
					</thead>
					<tbody>
						{#each data.entries as entry (entry.id)}
							<tr>
								<td class="row-identity">
									<a href="{base}/{entry.id}">{entry.name}</a>
									<span class="cell__sub">{entry.kindLabel}</span>
								</td>
								<td class="cell--num" data-label="Total allocated">{entry.total}</td>
								<td class="cell--num" data-label="Transactions">{entry.allocationCount}</td>
								<td data-label="Status">
									<span class="badge badge--{entry.statusTone}"><Icon name={statusIcons[entry.statusTone] ?? 'info'} size={12} />{entry.statusLabel}</span>
								</td>
								<td data-label="Responsible">
									{#if entry.responsibles.length > 0}
										{entry.responsibles.join(', ')}
									{:else}
										—
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{:else}
		<div class="panel">
			<Empty icon="tag" title="No purposes yet">
				{#if data.canCreate}
					<p class="muted">Add one above, or allocate straight from a transaction.</p>
				{/if}
			</Empty>
		</div>
	{/if}
</OrgShell>
