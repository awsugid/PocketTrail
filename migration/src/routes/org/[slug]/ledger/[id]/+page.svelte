<script lang="ts">
	import OrgHeader from '$lib/components/OrgHeader.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const entry = $derived(data.entry);
	const ledgerHref = $derived(`/org/${data.org.slug}/ledger`);
</script>

<svelte:head>
	<title>{entry.counterparty.name} · {data.org.name}</title>
</svelte:head>

<OrgHeader
	org={data.org}
	organizations={data.organizations}
	userName={data.user.name}
	csrfToken={data.csrfToken}
	active="ledger"
/>

<p style="margin: 20px 0 0"><a href={ledgerHref}>← Ledger</a></p>

<div class="page-head">
	<div>
		<h1>{entry.counterparty.name}</h1>
		<p class="meta-line">
			<span>{entry.date}{entry.time ? ` ${entry.time}` : ''}</span>
			<span>{entry.transactionType}</span>
			<span>{entry.pocketName}</span>
			<span class="badge badge--{entry.statusTone}">{entry.statusLabel}</span>
			{#if entry.suppressed}<span class="badge badge--muted">Notifications suppressed</span>{/if}
		</p>
	</div>
	<p style="margin: 0; font-size: 22px; font-weight: 650; letter-spacing: -0.02em">
		{entry.amount}
	</p>
</div>

<div class="detail-grid">
	<div>
		<section class="detail-section">
			<h2>Explanation</h2>
			{#if entry.explanation.trim() !== ''}
				<p class="prose-block">{entry.explanation}</p>
			{:else}
				<p class="muted">No explanation has been recorded yet.</p>
			{/if}
			{#if entry.needsDetails}
				<p class="notice">
					Documentation is still owed{entry.responsibleName ? ` by ${entry.responsibleName}` : ''}:
					{entry.amountMinor > 0
						? 'income needs member-authored notes.'
						: 'an expense needs notes plus evidence or a stated reason.'}
				</p>
			{/if}
		</section>

		<section class="detail-section">
			<h2>Purposes</h2>
			{#if entry.purposes.length > 0}
				<ul class="plain-list">
					{#each entry.purposes as purpose (purpose.id)}
						<li>
							{purpose.label} — {purpose.amount}
							{#if purpose.responsibleName}
								<span class="cell__sub">Responsible: {purpose.responsibleName}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted">This movement is recorded as a single purpose.</p>
			{/if}
		</section>

		<section class="detail-section">
			<h2>Evidence</h2>
			{#if entry.evidenceCount > 0}
				<p>{entry.evidenceCount} supporting document{entry.evidenceCount === 1 ? '' : 's'} attached.</p>
			{:else if entry.evidenceUnavailableReason.trim() !== ''}
				<p>No document attached. Reason recorded: {entry.evidenceUnavailableReason}</p>
			{:else}
				<p class="muted">No supporting document and no stated reason yet.</p>
			{/if}
		</section>

		<section class="detail-section">
			<h2>Review</h2>
			{#if entry.status === 'approved'}
				<p>
					Approved{entry.approvedByName ? ` by ${entry.approvedByName}` : ''}.
					{#if entry.approvalNote.trim() !== ''}<span class="cell__sub">{entry.approvalNote}</span>{/if}
				</p>
			{:else if entry.status === 'changes_requested'}
				<p>Changes were requested; the responsible member must save details before review.</p>
			{:else}
				<p class="muted">Awaiting review. Approval is not available in this migration slice.</p>
			{/if}
		</section>
	</div>

	<aside class="rail">
		<h2>Bank facts</h2>
		<dl class="facts">
			<dt>Date</dt>
			<dd>{entry.date}{entry.time ? ` ${entry.time}` : ''}</dd>
			<dt>Amount</dt>
			<dd>{entry.amount}</dd>
			<dt>Balance after</dt>
			<dd>{entry.balance}</dd>
			<dt>Type</dt>
			<dd>{entry.transactionType || '—'}</dd>
			<dt>Pocket</dt>
			<dd>{entry.pocketName}</dd>
			<dt>Counterparty</dt>
			<dd>
				{entry.counterparty.name}
				{#if entry.counterparty.bankAccount}
					<span class="cell__sub">{entry.counterparty.bankAccount}</span>
				{/if}
			</dd>
			<dt>Jago ID</dt>
			<dd>{entry.bankId ?? '—'}</dd>
			<dt>Responsible</dt>
			<dd>{entry.responsibleName ?? '—'}</dd>
		</dl>
		{#if entry.bankNotes.trim() !== ''}
			<h2 style="margin-top: 20px">Bank notes</h2>
			<p class="prose-block">{entry.bankNotes}</p>
		{/if}
	</aside>
</div>
