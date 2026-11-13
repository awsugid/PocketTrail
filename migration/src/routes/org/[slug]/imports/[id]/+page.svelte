<script lang="ts">
	import OrgShell from '$lib/components/OrgShell.svelte';
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
	<p class="back"><a href={base}>← Imports</a></p>

	<div class="page-head">
		<div>
			<h1>{data.preview ? 'Import preview' : 'Import batch'}</h1>
			<p class="lede">
				{#if data.preview}Nothing is recorded yet.{:else}Each row shows what happened to that statement entry.{/if}
				Batch #{data.batch.id} · {data.batch.createdAt} · {data.pocketName} · staged by {data.batch.byName}.
			</p>
		</div>
	</div>

	{#if hasResult}
		<p class="notice {conflicts > 0 ? 'notice--danger' : ''}" role="status">
			{counts.imported ?? 0} {data.preview ? 'new' : 'imported'} · {counts.duplicate_unchanged ?? 0} unchanged ·
			{counts.conflict ?? 0} conflicts · {counts.needs_review ?? 0} need review.
			{#if !data.preview && conflicts > 0}
				Conflicts and ID-less rows are listed for review; existing records were kept as they were.
			{/if}
		</p>
	{/if}

	{#if data.warnings.length > 0}
		<div class="notice {data.blockingWarnings ? 'notice--danger' : ''}" role="alert">
			<p style="margin: 0 0 6px">
				<strong>Extraction notes{data.blockingWarnings ? ' — resolve these before confirming' : ''}.</strong>
				Notes reference line and row numbers only, never statement content.
			</p>
			<ul style="margin: 0; padding-left: 1.2em">
				{#each data.warnings as warning, index (index)}
					<li>{warning}</li>
				{/each}
			</ul>
			{#if data.blockingWarnings}
				<p style="margin: 6px 0 0">
					Rows may be missing or wrong (skipped rows, missing transaction IDs, balance-chain breaks).
					Re-extract the statement and stage it again; nothing will be committed from this batch.
				</p>
			{/if}
		</div>
	{/if}

	{#if data.ownerRequired}
		<p class="notice notice--danger" role="status">
			This pocket has no active owner, so new rows cannot be assigned. Transfer pocket ownership in
			Settings, then stage the statement again.
		</p>
	{/if}

	{#if data.items.length === 0}
		<div class="empty-state">
			<p>Nothing in this batch.</p>
			<p class="muted">The statement text produced no importable rows. Check the pocket and the extracted text.</p>
		</div>
	{:else}
		<div class="table-scroll">
			<table class="ledger">
				<caption class="visually-hidden">
					Statement entries and how each is handled
				</caption>
				<thead>
					<tr>
						<th scope="col">Counterparty / bank reference</th>
						{#if data.preview}<th scope="col">Date</th>{/if}
						<th scope="col" class="cell--num">Amount</th>
						<th scope="col">Responsible</th>
						<th scope="col">Result</th>
						<th scope="col">Message</th>
						<th scope="col">Transaction</th>
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
								<td class="cell--nowrap" data-label="Date">
									{item.date}{item.time ? ` ${item.time}` : ''}
								</td>
							{/if}
							<td class="cell--num" data-label="Amount">{item.amount}</td>
							<td data-label="Responsible">{item.responsibleName ?? 'Unassigned'}</td>
							<td class="cell--nowrap" data-label="Result">
								<span class="badge badge--{badgeTone(item.status)}">{badgeLabel(item.status)}</span>
							</td>
							<td data-label="Message">{item.message || '—'}</td>
							<td data-label="Transaction">
								{#if item.transactionId}
									<a href="/org/{data.shell.org.slug}/transactions/{item.transactionId}">Open</a>
								{:else}—{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if data.preview && data.canConfirm}
		<div class="confirm-bar">
			{#if data.ready}
				<form method="POST" action="?/confirm">
					<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
					<button class="btn btn--primary" type="submit">Confirm import</button>
				</form>
				<p class="muted">Confirming creates only the new movements shown above. Unchanged records are skipped.</p>
			{:else}
				<p class="notice">
					Confirmation is blocked until the extraction notes and missing IDs are resolved and the pocket has an
					active owner.
				</p>
			{/if}
		</div>
	{/if}
</OrgShell>

<style>
	.back {
		margin: 0 0 8px;
	}
	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}
	.confirm-bar {
		margin-top: 24px;
		display: flex;
		flex-wrap: wrap;
		gap: 12px 16px;
		align-items: center;
	}
	.confirm-bar p {
		margin: 0;
		max-width: 52ch;
		font-size: 13px;
	}
</style>
