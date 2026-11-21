<script lang="ts">
	import { fmtMoney } from '$lib/fmt';
	import Empty from '$lib/components/Empty.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import AvatarStack from '$lib/components/list/AvatarStack.svelte';
	import FilterBar from '$lib/components/list/FilterBar.svelte';
	import SummaryCards from '$lib/components/list/SummaryCards.svelte';
	import Pagination from '$lib/components/list/Pagination.svelte';
	import StatusBadge from '$lib/components/list/StatusBadge.svelte';
	import { ledgerDate } from '$lib/components/list/helpers';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const slug = $derived(data.shell.org.slug);
	const base = $derived(`/org/${slug}/transactions`);
	let expanded = $state<number[]>([]);
	const filtered = $derived(Object.entries(data.selection).some(([key, value]) => key !== 'page' && (Array.isArray(value) ? value.length > 0 : value !== null && value !== '')));
	const cards = $derived([
		{ label: 'Balance', icon: 'pocket' as const, value: data.summary.closingBalance === null ? '—' : fmtMoney(data.summary.closingBalance), title: 'Closing balance' },
		{ label: 'Income', icon: 'imports' as const, tone: 'income', value: fmtMoney(data.summary.income) },
		{ label: 'Expense', icon: 'upload' as const, tone: 'action', value: fmtMoney(data.summary.expense) },
		{ label: 'Net', icon: 'ledger' as const, value: fmtMoney(data.summary.net) },
		{ label: 'Your action', icon: 'alert' as const, tone: 'action', value: data.summary.needsActionCount, detail: fmtMoney(data.summary.needsActionAmount) },
		{ label: 'In review', icon: 'history' as const, tone: 'review', value: data.summary.pendingReviewCount },
		{ label: 'Changes', icon: 'history' as const, tone: 'action', value: data.summary.changesRequestedCount, title: 'Changes requested' }
	]);
</script>

<svelte:head><title>Ledger · {data.shell.org.name}</title></svelte:head>

<OrgShell {...data.shell} active="transactions">
	<PageHead title="Ledger" icon="ledger">
		{#snippet actions()}
			{#if data.canImport}<a class="btn" href="/org/{slug}/imports"><Icon name="imports" size={16} />Import</a>{/if}
			{#if data.canDocument}<a class="btn btn--primary" href="{base}/new"><Icon name="plus" size={16} />Record</a>{/if}
		{/snippet}
	</PageHead>
	<SummaryCards items={cards} />
	<FilterBar selection={data.selection} options={data.filterOptions} />
	{#if data.entries.length > 0}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable table needs keyboard access.) -->
		<div class="panel"><div class="table-scroll" tabindex="0" role="region" aria-label="Ledger table">
			<table class="ledger list-table">
				<caption class="visually-hidden">Bank movements with amounts, balances, status, and responsible members</caption>
				<thead><tr><th scope="col"><span class="visually-hidden">Allocations</span></th><th scope="col">Date</th><th scope="col">Counterparty</th><th scope="col" class="cell--num">Amount</th><th scope="col" class="cell--num">Balance</th><th scope="col">Responsible</th><th scope="col">Status</th></tr></thead>
				<tbody>
					{#each data.entries as entry (entry.id)}
						<tr data-tone={entry.tone}>
							<td><button class="btn btn--quiet btn--sm btn--icon row-expand" aria-label={`Allocations for ${entry.counterparty.name}`} aria-expanded={expanded.includes(entry.id)} aria-controls={`allocations-${entry.id}`} onclick={() => expanded = expanded.includes(entry.id) ? expanded.filter(id => id !== entry.id) : [...expanded, entry.id]}><Icon name="chevron" size={16} /></button></td>
							<td class="cell--nowrap">{ledgerDate(entry.date)}{#if entry.time}<span class="cell__sub">{entry.time}</span>{/if}</td>
							<td class="row-identity"><a href="{base}/{entry.id}">{entry.counterparty.name}</a>{#if entry.bankId}<span class="cell__sub">{entry.bankId}</span>{/if}</td>
							<td class="cell--num" class:amount--in={entry.amountMinor > 0} class:amount--out={entry.amountMinor < 0}>{entry.amountMinor > 0 ? '+' : ''}{fmtMoney(entry.amountMinor)}</td>
							<td class="cell--num">{entry.balanceMinor === null ? '—' : fmtMoney(entry.balanceMinor)}</td>
							<td><AvatarStack members={entry.responsibles} /></td>
							<td><StatusBadge status={entry.status} />{#if entry.suppressed}<span class="cell__sub">Notifications suppressed</span>{/if}</td>
						</tr>
						{#if expanded.includes(entry.id)}
							<tr class="list-detail" id={`allocations-${entry.id}`}><td colspan="7">
								<ul class="allocation-list" aria-label="Purpose allocations">
									{#each entry.allocations as allocation (allocation.purposeId)}
										<li><a href="/org/{slug}/purposes/{allocation.purposeId}">{allocation.purposeName}</a><span class="cell--num">{fmtMoney(allocation.amountMinor)}</span><StatusBadge status={allocation.status} /><AvatarStack members={allocation.responsibles} /></li>
									{:else}<li><span class="muted">No purpose</span>{#if data.canDocument}<a class="btn btn--sm" href="{base}/{entry.id}">Assign purpose</a>{/if}</li>{/each}
								</ul>
								{#if entry.unallocatedMinor > 0}<p class="unallocated">Unallocated: {fmtMoney(entry.unallocatedMinor)}</p>{/if}
							</td></tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div></div>
	{:else}
		<div class="panel">
			{#if !filtered}<Empty icon="ledger" title="No movements yet">{#if data.canImport}<a class="btn btn--primary" href="/org/{slug}/imports"><Icon name="imports" size={16} />Import a statement</a>{/if}</Empty>
			{:else}<Empty icon="filter" title="No matching transactions"><a class="btn" href={base}>Show all</a></Empty>{/if}
		</div>
	{/if}
	<Pagination page={data.page} pageCount={data.pageCount} total={data.total} label="Ledger pages" />
</OrgShell>
