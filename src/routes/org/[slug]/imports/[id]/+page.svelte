<script lang="ts">
	import Empty from '$lib/components/Empty.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import { submit } from '$lib/forms';
	import { stack } from '$lib/table';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const base = $derived(`/org/${data.shell.org.slug}/imports`);
	const counts = $derived(data.batch.counts);
	const hasResult =
		$derived(counts.imported !== undefined || counts.duplicate_unchanged !== undefined || counts.conflict !== undefined);
	const conflicts = $derived((counts.conflict ?? 0) + (counts.needs_review ?? 0));

	function badgeTone(status: string): string {
		if (status === 'imported') return 'approved';
		if (status === 'duplicate_unchanged') return 'muted';
		if (status === 'conflict') return 'changes';
		if (status === 'needs_review') return 'needs';
		return 'muted';
	}
	function badgeLabel(status: string): string {
		if (status === 'imported') return data.preview ? 'Will import' : 'Imported';
		if (status === 'duplicate_unchanged') return data.preview ? 'Skip (unchanged)' : 'Unchanged';
		if (status === 'conflict') return 'Conflict';
		if (status === 'needs_review') return 'Needs review';
		return status;
	}
</script>

<svelte:head>
	<title>{data.preview ? 'Import preview' : 'Import batch'} · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="imports">
	<PageHead title={data.preview ? 'Import preview' : 'Import batch'} icon="imports" back={{ href: base, label: 'Imports' }}>
		{#snippet meta()}
			<span>#{data.batch.id}</span>
			<span>{data.pocketName}</span>
			<span>{data.batch.createdAt}</span>
			<span>{data.batch.byName}</span>
		{/snippet}
	</PageHead>

	{#if hasResult}
		<div class="stats" role="status">
			<span class="badge badge--{(counts.imported ?? 0) > 0 ? 'approved' : 'muted'}">{counts.imported ?? 0} {data.preview ? 'new' : 'imported'}</span>
			<span class="badge badge--muted">{counts.duplicate_unchanged ?? 0} unchanged</span>
			<span class="badge badge--{(counts.conflict ?? 0) > 0 ? 'changes' : 'muted'}">{counts.conflict ?? 0} conflicts</span>
			<span class="badge badge--{(counts.needs_review ?? 0) > 0 ? 'needs' : 'muted'}">{counts.needs_review ?? 0} to review</span>
		</div>
	{/if}

	{#if data.warnings.length > 0}
		<Notice tone={data.blockingWarnings ? 'danger' : 'warning'}>
			<strong>{data.blockingWarnings ? 'Resolve before confirming' : 'Extraction notes'}</strong>
			<ul>
				{#each data.warnings as warning, index (index)}<li>{warning}</li>{/each}
			</ul>
		</Notice>
	{/if}

	{#if data.ownerRequired}
		<Notice tone="danger">
			This pocket has no active owner. Set one in <a href="/org/{data.shell.org.slug}/settings/pockets">Settings</a>, then stage again.
		</Notice>
	{/if}

	<div class="panel">
		{#if data.items.length === 0}
			<Empty icon="imports" title="No importable rows" inline />
		{:else}
			<div class="table-scroll">
				<table class="ledger stack" use:stack>
					<caption class="visually-hidden">Statement entries and how each is handled</caption>
					<thead>
						<tr>
							<th scope="col">Counterparty</th>
							{#if data.preview}<th scope="col">Date</th>{/if}
							<th scope="col" class="cell--num">Amount</th>
							<th scope="col">Responsible</th>
							<th scope="col">Result</th>
							<th scope="col">Message</th>
							<th scope="col"><span class="visually-hidden">Transaction</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.items as item, index (index)}
							<tr>
								<td class="row-identity">
									<strong>{item.counterpartyDisplay.name}</strong>
									{#if item.counterpartyDisplay.bankAccount}
										<span class="cell__sub">{item.counterpartyDisplay.bankAccount}</span>
									{/if}
									<span class="cell__sub mono">{item.bankId || '—'}</span>
								</td>
								{#if data.preview}
									<td class="cell--nowrap" data-label="Date">{item.date}{item.time ? ` ${item.time}` : ''}</td>
								{/if}
								<td class="cell--num" data-label="Amount">{item.amount}</td>
								<td data-label="Responsible">{item.responsibleName ?? 'Unassigned'}</td>
								<td class="cell--nowrap" data-label="Result"><span class="badge badge--{badgeTone(item.status)}">{badgeLabel(item.status)}</span></td>
								<td data-label="Message">{item.message || '—'}</td>
								<td class="cell--nowrap">
									{#if item.transactionId}
										<a href="/org/{data.shell.org.slug}/transactions/{item.transactionId}">Open<span class="visually-hidden"> transaction</span></a>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	{#if data.preview && data.canConfirm}
		<div class="sticky-bar">
			{#if data.ready}
				<form method="POST" action="?/confirm" use:submit>
					<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
					<button class="btn btn--primary" type="submit"><Icon name="check" size={16} />Confirm import</button>
				</form>
				<span class="muted">Only the new movements above are recorded.</span>
			{:else}
				<Icon name="alert" size={16} />
				<span>Confirmation is blocked until the notes above are resolved.</span>
			{/if}
		</div>
	{/if}
</OrgShell>
