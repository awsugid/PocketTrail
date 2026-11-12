<script lang="ts">
	import OrgShell from '$lib/components/OrgShell.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const base = $derived(`/org/${data.shell.org.slug}/transactions`);
	const countLabel = $derived(
		`${data.entries.length}${data.hasNext ? '+' : ''} transaction${data.entries.length === 1 ? '' : 's'}`
	);
</script>

<OrgShell {...data.shell} active="transactions">
	<div class="page-head">
		<div>
			<h1>Ledger</h1>
			<p class="lede">
				Bank movements from this organization's pockets. Money facts come from statements; explanations,
				evidence, and approval are added here.
			</p>
		</div>
	</div>

<form class="toolbar" method="GET" action={base}>
	<div class="field">
		<label for="filter-status">Status</label>
		<select class="select" id="filter-status" name="status">
			{#each data.filters as option (option.value)}
				<option value={option.value} selected={data.filter === option.value}>{option.label}</option>
			{/each}
		</select>
	</div>
	<button class="btn" type="submit">Apply</button>
	{#if data.filter !== 'all'}
		<a class="btn btn--quiet" href={base}>Clear</a>
	{/if}
	<p class="count">
		{countLabel}{data.page > 1 ? ` · page ${data.page}` : ''}
		{#if data.owedCount > 0}
			· {data.owedCount} on this page need details
		{/if}
	</p>
</form>

{#if data.entries.length > 0}
	<div class="table-scroll">
		<!-- Explicit roles are not redundant here: below 640px the rule in
		     app.css stacks these cells with `display: block`, which drops the
		     implicit table roles in some assistive technology. -->
		<!-- svelte-ignore a11y_no_redundant_roles -->
		<table class="ledger" role="table">
			<caption class="visually-hidden">
				Bank movements with amounts, balances, review status, and responsible member
			</caption>
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
						<td
							class="cell--num {entry.amountMinor > 0 ? 'amount--in' : ''}"
							role="cell"
							data-label="Amount">{entry.amount}</td
						>
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

	{#if data.page > 1 || data.hasNext}
		<nav class="pager" aria-label="Ledger pages">
			{#if data.page > 1}
				<a class="btn" href="{base}?status={data.filter}&page={data.page - 1}">Previous</a>
			{/if}
			{#if data.hasNext}
				<a class="btn" href="{base}?status={data.filter}&page={data.page + 1}">Next</a>
			{/if}
		</nav>
	{/if}
{:else}
	<div class="empty-state">
		{#if data.filter === 'all'}
			<p>No bank movements have been recorded for this organization yet.</p>
			<p class="muted">
				Movements arrive by importing a bank statement
				{#if data.canImport}
					— <a href="/org/{data.shell.org.slug}/imports">start an import</a>.
				{:else}
					; ask a member who can import statements.
				{/if}
			</p>
		{:else}
			<p>No transactions match this status filter.</p>
			<p class="muted">
				<a href={base}>Show all transactions</a> to see the rest of the ledger.
			</p>
		{/if}
	</div>
{/if}
</OrgShell>

