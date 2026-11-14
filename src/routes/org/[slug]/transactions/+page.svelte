<script lang="ts">
	import Empty from '$lib/components/Empty.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const slug = $derived(data.shell.org.slug);
	const base = $derived(`/org/${slug}/transactions`);
	const href = (status: string, page = 1) => {
		const query = new URLSearchParams();
		if (status !== 'all') query.set('status', status);
		if (page > 1) query.set('page', String(page));
		const text = query.toString();
		return text ? `${base}?${text}` : base;
	};
</script>

<svelte:head>
	<title>Ledger · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="transactions">
	<PageHead title="Ledger" icon="ledger">
		{#snippet actions()}
			{#if data.canDocument}
				<a class="btn btn--primary" href="{base}/new"><Icon name="plus" size={16} />Record</a>
			{/if}
		{/snippet}
	</PageHead>

	<div class="toolbar">
		<nav class="chips" aria-label="Status filter">
			{#each data.filters as option (option.value)}
				<a class="chip" href={href(option.value)} aria-current={data.filter === option.value ? 'true' : undefined}>
					{option.label}
				</a>
			{/each}
		</nav>
		<span class="count">
			{data.entries.length}{data.hasNext ? '+' : ''} shown{data.page > 1 ? ` · page ${data.page}` : ''}
		</span>
	</div>

	{#if data.entries.length > 0}
		<div class="panel">
			<div class="table-scroll">
				<!-- Explicit roles: below 640px the stacking rule sets `display: block`, which
				     drops implicit table semantics in some assistive technology. -->
				<!-- svelte-ignore a11y_no_redundant_roles -->
				<table class="ledger stack" role="table">
					<caption class="visually-hidden">Bank movements with amounts, balances, status, and responsible member</caption>
					<thead>
						<tr>
							<th scope="col">Counterparty</th>
							<th scope="col">Date</th>
							<th scope="col" class="cell--num">Amount</th>
							<th scope="col" class="cell--num">Balance after</th>
							<th scope="col">Status</th>
							<th scope="col">Responsible</th>
						</tr>
					</thead>
					<tbody>
						{#each data.entries as entry (entry.id)}
							<!-- svelte-ignore a11y_no_redundant_roles -->
							<tr role="row">
								<td class="row-identity" role="cell">
									<a href="{base}/{entry.id}">{entry.counterparty.name}</a>
									{#if entry.counterparty.bankAccount}
										<span class="cell__sub">{entry.counterparty.bankAccount}</span>
									{/if}
									<span class="cell__sub">
										{entry.transactionType}{entry.transactionType && entry.pocketName ? ' · ' : ''}{entry.pocketName}
									</span>
								</td>
								<td class="cell--nowrap" role="cell" data-label="Date">
									{entry.date}
									{#if entry.time}<span class="cell__sub">{entry.time}</span>{/if}
								</td>
								<td class="cell--num {entry.amountMinor > 0 ? 'amount--in' : ''}" role="cell" data-label="Amount">
									{entry.amount}
								</td>
								<td class="cell--num" role="cell" data-label="Balance after">{entry.balance}</td>
								<td role="cell" data-label="Status">
									<span class="badge badge--{entry.statusTone}">{entry.statusLabel}</span>
									{#if entry.suppressed}
										<span class="cell__sub">Notifications suppressed</span>
									{/if}
								</td>
								<td role="cell" data-label="Responsible">{entry.responsibleName ?? '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>

		{#if data.page > 1 || data.hasNext}
			<nav class="pager" aria-label="Ledger pages">
				{#if data.page > 1}
					<a class="btn" href={href(data.filter, data.page - 1)}><Icon name="back" size={16} />Previous</a>
				{/if}
				{#if data.hasNext}
					<a class="btn" href={href(data.filter, data.page + 1)}>Next<Icon name="next" size={16} /></a>
				{/if}
			</nav>
		{/if}
	{:else}
		<div class="panel">
			{#if data.filter === 'all'}
				<Empty icon="ledger" title="No movements yet">
					{#if data.canImport}
						<a class="btn btn--primary" href="/org/{slug}/imports"><Icon name="imports" size={16} />Import a statement</a>
					{/if}
				</Empty>
			{:else}
				<Empty icon="filter" title="Nothing with this status">
					<a class="btn" href={base}>Show all</a>
				</Empty>
			{/if}
		</div>
	{/if}
</OrgShell>
