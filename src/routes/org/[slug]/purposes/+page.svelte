<script lang="ts">
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { fmtMoney, fmtDate } from '#lib/fmt.ts';
	import Empty from '#lib/components/Empty.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import OrgShell from '#lib/components/OrgShell.svelte';
	import PageHead from '#lib/components/PageHead.svelte';
	import Select from '#lib/components/ui/FormSelect.svelte';
	import AvatarStack from '#lib/components/list/AvatarStack.svelte';
	import FilterBar from '#lib/components/list/FilterBar.svelte';
	import SummaryCards from '#lib/components/list/SummaryCards.svelte';
	import Pagination from '#lib/components/list/Pagination.svelte';
	import StatusBadge from '#lib/components/list/StatusBadge.svelte';
	import { statuses, type Status } from '#lib/components/list/helpers.ts';
	import { submit, unsavedGuard } from '#lib/forms.ts';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const slug = $derived(data.shell.org.slug);
	const base = $derived(`/org/${slug}/purposes`);
	let kind = $state('expense');
	let expanded = $state<number[]>([]);
	const filtered = $derived(Object.entries(data.selection).some(([key, value]) => key !== 'page' && (Array.isArray(value) ? value.length > 0 : value !== null && value !== '')));
	const cards = $derived([
		{ label: 'Allocated', icon: 'pocket' as const, value: fmtMoney(data.summary.totalAllocated) },
		{ label: 'Your action', icon: 'alert' as const, tone: 'action', value: data.summary.needsActionCount },
		{ label: 'Needs details', icon: 'file' as const, tone: 'waiting', value: data.summary.byStatus.needs_details },
		{ label: 'In review', icon: 'history' as const, tone: 'review', value: data.summary.byStatus.pending_review },
		{ label: 'Approved', icon: 'check' as const, tone: 'income', value: data.summary.byStatus.approved },
		{ label: 'Changes', icon: 'history' as const, tone: 'action', value: data.summary.byStatus.changes_requested, title: 'Changes requested' }
	]);
</script>

<svelte:head><title>Purposes · {data.shell.org.name}</title></svelte:head>

<OrgShell {...data.shell} active="purposes">
	<PageHead title="Purposes" icon="tag" />
	<SummaryCards items={cards} />
	<FilterBar selection={data.selection} options={data.filterOptions} needsActionCount={data.summary.needsActionCount} purposes />
	{#if data.entries.length > 0}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable table needs keyboard access.) -->
		<div class="panel"><div class="table-scroll" tabindex="0" role="region" aria-label="Purposes table">
			<table class="ledger list-table">
				<caption class="visually-hidden">Purposes with total allocated, transactions, responsible members, and status</caption>
				<thead><tr><th scope="col"><span class="visually-hidden">Allocated transactions</span></th><th scope="col">Purpose</th><th scope="col" class="cell--num">Total allocated</th><th scope="col" class="cell--num">Transactions</th><th scope="col">Responsible</th><th scope="col">Status</th></tr></thead>
				<tbody>
					{#each data.entries as entry (entry.id)}
						<tr data-tone={entry.tone}>
							<td><Button class="row-expand" aria-label={`Transactions for ${entry.name}`} aria-expanded={expanded.includes(entry.id)} aria-controls={`transactions-${entry.id}`} onclick={() => expanded = expanded.includes(entry.id) ? expanded.filter(id => id !== entry.id) : [...expanded, entry.id]}><Icon name="chevron" size={16} /></Button></td>
							<td class="row-identity"><a href={entry.url}>{entry.name}</a><span class="cell__sub">{entry.kindLabel}</span></td>
							<td class="cell--num">{fmtMoney(entry.totalAllocatedMinor)}</td>
							<td class="cell--num">{entry.allocationCount}</td>
							<td><AvatarStack members={entry.responsibles} /></td>
							<td><StatusBadge status={entry.status} /></td>
						</tr>
						{#if expanded.includes(entry.id)}
							<tr class="list-detail" id={`transactions-${entry.id}`}><td colspan="6">
								<ul class="allocation-list" aria-label="Allocated transactions">
									{#each entry.transactions as transaction (transaction.id)}
										<li><span class="cell--nowrap">{fmtDate(transaction.date)}</span><div><a href="/org/{slug}/transactions/{transaction.id}">{transaction.counterparty}</a>{#if transaction.bankId}<span class="cell__sub">{transaction.bankId}</span>{/if}</div><span class="cell--num">{fmtMoney(transaction.allocatedMinor)}</span><StatusBadge status={transaction.status} /></li>
									{:else}<li class="muted">No allocated transactions</li>{/each}
								</ul>
							</td></tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div></div>
	{:else}
		<div class="panel">
			{#if filtered}<Empty icon="filter" title="No matching purposes"><a class="btn" href={base}>Show all</a></Empty>
			{:else}<Empty icon="tag" title="No purposes yet">{#if data.canCreate}<p class="muted">Add one below, or allocate straight from a transaction.</p>{/if}</Empty>{/if}
		</div>
	{/if}
	<Pagination page={data.page} pageCount={data.pageCount} total={data.total} label="Purpose pages" />

	{#if data.canCreate}
		<section class="panel" aria-labelledby="new-purpose-heading">
			<div class="panel__head"><Icon name="plus" size={16} /><h2 id="new-purpose-heading">New purpose</h2></div>
			<div class="panel__body">
				<form method="POST" action="?/create" class="form form--inline" use:submit use:unsavedGuard>
					<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
					<div class="field"><Label for="purpose-name">Name</Label><Input class="" id="purpose-name" name="name" required maxlength={300} placeholder="Food for June meetup" /></div>
					<div class="field"><Label for="purpose-kind">Records</Label><Select id="purpose-kind" name="kind" items={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]} bind:value={kind} required /></div>
					<Button class="" type="submit" variant="default"><Icon name="plus" size={16} />Add purpose</Button>
				</form>
			</div>
		</section>
	{/if}
</OrgShell>
