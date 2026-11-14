<script lang="ts">
	import Select from '$lib/components/ui/Select.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import { submit } from '$lib/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const txn = $derived(data.txn);
	const tone = $derived(
		txn.status === 'approved'
			? 'approved'
			: txn.status === 'changes_requested'
				? 'changes'
				: txn.needsDetails
					? 'needs'
					: 'review'
	);

	interface SplitDraft {
		label: string;
		amount: string;
		member: string;
	}

	const draftOf = () => ({
		splits: txn.splits.map((split) => ({
			label: split.label,
			amount: split.rupiah,
			member: split.responsibleMemberId === null ? '' : String(split.responsibleMemberId)
		})),
		responsible: txn.responsibleMemberId === null ? '' : String(txn.responsibleMemberId)
	});

	// Seeded at initialisation so the server-rendered form (and a no-JavaScript
	// submit) already carries the saved purposes.
	const initial = draftOf();
	let splits = $state<SplitDraft[]>(initial.splits);
	let responsible = $state(initial.responsible);
	let seededRevision: number | null = null;

	// Re-seed when the server hands back a new revision (an action reload).
	$effect(() => {
		const first = seededRevision === null;
		const changed = seededRevision !== txn.revision;
		seededRevision = txn.revision;
		if (first || !changed) return;
		const next = draftOf();
		splits = next.splits;
		responsible = next.responsible;
	});

	function addSplit() {
		splits = [...splits, { label: '', amount: '', member: responsible }];
	}
	function removeSplit(index: number) {
		if (splits.length <= 1) return;
		splits = splits.filter((_, i) => i !== index);
	}

	const statusLabel = $derived(
		txn.isIncome
			? txn.incomeComplete
				? 'Income noted'
				: 'Income notes needed'
			: txn.status === 'approved'
				? 'Approved'
				: txn.status === 'changes_requested'
					? 'Changes requested'
					: txn.needsDetails
						? 'Needs details'
						: 'Pending review'
	);
</script>

<svelte:head>
	<title>{txn.counterpartyDisplay.name} · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="transactions">
	<PageHead title={txn.counterpartyDisplay.name} back={{ href: `/org/${data.shell.org.slug}/transactions`, label: 'Ledger' }}>
		{#snippet actions()}
			<p class="amount-total" class:amount--in={txn.amountMinor > 0}>{txn.amount}</p>
		{/snippet}
		{#snippet meta()}
			<span class="badge badge--{tone}">{statusLabel}</span>
			{#if txn.suppressed}<span class="badge badge--muted"><Icon name="bell" size={12} />Suppressed</span>{/if}
			<span>{txn.date}{txn.time ? ` ${txn.time}` : ''}</span>
			<span>{txn.transactionType || 'Movement'}</span>
			<span>{txn.pocketName}</span>
		{/snippet}
	</PageHead>

	{#if data.msg}<Notice tone="success">{data.msg}</Notice>{/if}

	{#if txn.missing.length > 0 && !txn.isIncome}
		<Notice tone="warning">
			<strong>Needed before review</strong>
			<ul>
				{#each txn.missing as item (item)}<li>{item}</li>{/each}
			</ul>
		</Notice>
	{/if}

	<div class="detail-grid">
		<div class="stack">
			<section class="panel" aria-labelledby="explain-heading">
				<div class="panel__head">
					<Icon name="comment" size={16} /><h2 id="explain-heading">{txn.isIncome ? 'Income notes' : 'Explanation'}</h2>
				</div>
				<div class="panel__body">
					{#if !txn.can.edit && !txn.can.incomeNotes}
						{#if txn.explanation.trim() !== ''}
							<p class="prose-block">{txn.explanation}</p>
						{:else}
							<p class="muted">Nothing recorded.</p>
						{/if}
					{:else}
						<form method="POST" action="?/details" class="form" use:submit>
							<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
							<input type="hidden" name="revision" value={txn.revision} />
							<div class="field">
								<label for="explanation">{txn.isIncome ? 'Notes' : 'Explanation'} <span class="req" aria-hidden="true">*</span></label>
								<textarea class="input textarea" id="explanation" name="explanation" required>{txn.explanation}</textarea>
							</div>

							{#if !txn.isIncome && txn.can.edit}
								<div class="field">
									<label for="responsible">Responsible member <span class="req" aria-hidden="true">*</span></label>
									<Select id="responsible" name="responsible_member_id" items={[{ value: '', label: 'Choose a member' }, ...txn.members.map((member) => ({ value: String(member.id), label: member.name }))]} bind:value={responsible} required />
								</div>

								<fieldset class="form">
									<legend>
										Purposes <span class="muted count">of {txn.amount}</span>
									</legend>
									{#each splits as row, index (index)}
										<div class="split-row">
											<div class="field">
												<label for="split-label-{index}">Purpose {index + 1}</label>
												<input class="input" id="split-label-{index}" name="split_label[]" bind:value={row.label} required />
											</div>
											<div class="field">
												<label for="split-amount-{index}">Amount (IDR)</label>
												<input class="input" id="split-amount-{index}" name="split_amount[]" inputmode="decimal" bind:value={row.amount} required />
											</div>
											<div class="field">
												<label for="split-member-{index}">Responsible</label>
												<Select id="split-member-{index}" name="split_member[]" items={[{ value: '', label: 'Choose a member' }, ...txn.members.map((member) => ({ value: String(member.id), label: member.name }))]} bind:value={row.member} required />
											</div>
											<button
												class="btn btn--quiet btn--icon"
												type="button"
												aria-label="Remove purpose {index + 1}"
												onclick={() => removeSplit(index)}
												disabled={splits.length <= 1}
											>
												<Icon name="trash" size={16} />
											</button>
										</div>
									{/each}
									<div class="form-actions">
										<button class="btn btn--sm" type="button" onclick={addSplit}><Icon name="plus" size={14} />Purpose</button>
									</div>
									{#if txn.totals}
										<p class="hint" role="status">
											{txn.totals.splitTotalMinor === txn.totals.amountMinor ? 'Saved purposes match the bank amount.' : 'Saved purposes differ from the bank amount.'}
										</p>
									{/if}
								</fieldset>

								<div class="field">
									<label for="reason">No document available — why?</label>
									<input class="input" id="reason" name="evidence_unavailable_reason" value={txn.evidenceUnavailableReason} />
								</div>
							{/if}

							<div class="form-actions">
								<button class="btn btn--primary" type="submit"><Icon name="check" size={16} />Save</button>
							</div>
						</form>
					{/if}
				</div>
			</section>

			{#if !txn.isIncome && txn.splits.length > 0}
				<section class="panel" aria-labelledby="purposes-heading">
					<div class="panel__head">
						<Icon name="ledger" size={16} /><h2 id="purposes-heading">Purposes</h2>
						<span class="count">{txn.splits.length}</span>
					</div>
					<ul class="rows">
						{#each txn.splits as split (split.label + split.amountMinor)}
							<li>
								<div class="rows__main">
									<strong>{split.label}</strong>
									{#if split.responsibleName}<span class="rows__sub">{split.responsibleName}</span>{/if}
								</div>
								<span class="cell--nowrap">{split.amount}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<section class="panel" aria-labelledby="evidence-heading">
				<div class="panel__head">
					<Icon name="file" size={16} /><h2 id="evidence-heading">Evidence</h2>
					<span class="count">{txn.evidence.length}</span>
				</div>
				{#if txn.evidence.length > 0}
					<ul class="rows">
						{#each txn.evidence as document (document.id)}
							<li>
								<div class="rows__main">
									<a href={document.url}>{document.filename}</a>
									<span class="rows__sub">{document.sizeDisplay}{document.note ? ` · ${document.note}` : ''}</span>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
				{#if txn.evidence.length === 0 && txn.evidenceUnavailableReason.trim() !== ''}
					<div class="panel__body">
						<p class="prose-block"><span class="muted">No document:</span> {txn.evidenceUnavailableReason}</p>
					</div>
				{/if}
				{#if txn.can.upload}
					<div class="panel__body {txn.evidence.length > 0 ? 'panel__body--ruled' : ''}">
						<form method="POST" action="?/document" enctype="multipart/form-data" class="form form--inline" use:submit={{ reset: true }}>
							<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
							<input type="hidden" name="revision" value={txn.revision} />
							<div class="field">
								<label for="evidence-file">File <span class="muted">PDF, PNG, JPEG · 10 MB</span></label>
								<input class="input" id="evidence-file" name="file" type="file" accept="application/pdf,image/png,image/jpeg" required />
							</div>
							<div class="field">
								<label for="evidence-note">Note</label>
								<input class="input" id="evidence-note" name="note" />
							</div>
							<button class="btn" type="submit"><Icon name="upload" size={16} />Attach</button>
						</form>
					</div>
				{/if}
			</section>

			{#if !txn.isIncome}
				<section class="panel" aria-labelledby="review-heading">
					<div class="panel__head"><Icon name="check" size={16} /><h2 id="review-heading">Review</h2></div>
					<div class="panel__body stack">
						{#if txn.reviewDecision}
							<p>
								<strong>{txn.reviewDecision.statusLabel}</strong>
								<span class="muted">{txn.reviewDecision.authorName} · {txn.reviewDecision.createdAt}</span>
								{#if txn.reviewDecision.note.trim() !== ''}
									<span class="prose-block">{txn.reviewDecision.note}</span>
								{/if}
							</p>
						{:else if txn.status === 'approved'}
							<p><strong>Approved</strong></p>
						{:else}
							<p class="muted">Awaiting review.</p>
						{/if}

						{#if txn.can.approve}
							{#if txn.approval.eligible}
								<form method="POST" action="?/approve" class="form form--inline" use:submit>
									<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
									<input type="hidden" name="revision" value={txn.revision} />
									<div class="field">
										<label for="approve-note">Approval note</label>
										<input class="input" id="approve-note" name="note" />
									</div>
									<button class="btn btn--primary" type="submit"><Icon name="check" size={16} />Approve</button>
								</form>
								<form method="POST" action="?/requestChanges" class="form form--inline" use:submit>
									<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
									<input type="hidden" name="revision" value={txn.revision} />
									<div class="field">
										<label for="changes-note">What needs changing? <span class="req" aria-hidden="true">*</span></label>
										<input class="input" id="changes-note" name="note" required />
									</div>
									<button class="btn" type="submit"><Icon name="alert" size={16} />Request changes</button>
								</form>
							{:else}
								<p class="muted">{(txn.approval.ineligibleReason ?? 'You cannot decide this transaction.').replace(/^./, (c) => c.toUpperCase())}</p>
							{/if}
						{/if}

						{#if txn.can.submit}
							<form method="POST" action="?/submit" use:submit>
								<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
								<input type="hidden" name="revision" value={txn.revision} />
								<button class="btn" type="submit"><Icon name="next" size={16} />Resubmit for review</button>
							</form>
						{/if}
					</div>
				</section>
			{/if}

			<section class="panel" aria-labelledby="discussion-heading">
				<div class="panel__head">
					<Icon name="comment" size={16} /><h2 id="discussion-heading">Discussion</h2>
					<span class="count">{txn.comments.length}</span>
				</div>
				{#if txn.comments.length > 0}
					<div class="panel__body">
						<ol class="timeline">
							{#each txn.comments as comment, index (index)}
								<li>
									<p class="muted"><strong>{comment.authorName}</strong> · {comment.createdAt}</p>
									<p class="prose-block">{comment.body}</p>
								</li>
							{/each}
						</ol>
					</div>
				{/if}
				{#if txn.can.comment}
					<div class="panel__body {txn.comments.length > 0 ? 'panel__body--ruled' : ''}">
						<form method="POST" action="?/comment" class="form" use:submit={{ reset: true }}>
							<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
							<div class="field">
								<label for="comment-body">Comment</label>
								<textarea class="input textarea" id="comment-body" name="body" rows="3" required placeholder="Mention a member with @handle"></textarea>
							</div>
							<div class="form-actions">
								<button class="btn" type="submit"><Icon name="comment" size={16} />Post</button>
							</div>
						</form>
					</div>
				{/if}
			</section>

			<section class="panel" aria-labelledby="history-heading">
				<div class="panel__head">
					<Icon name="history" size={16} /><h2 id="history-heading">History</h2>
					<span class="count">{txn.audit.length}</span>
				</div>
				{#if txn.audit.length > 0}
					<div class="panel__body">
						<ol class="timeline">
							{#each txn.audit as entry, index (index)}
								<li>
									<p><strong>{entry.actionLabel}</strong> <span class="muted">{entry.authorName} · {entry.createdAt}</span></p>
									{#if entry.previousLabel !== entry.newLabel}
										<p class="rows__sub">{entry.previousLabel} → {entry.newLabel}</p>
									{/if}
									{#each entry.facts as fact, index (index)}
										<p class="rows__sub">{fact[0]}: {fact[1]}</p>
									{/each}
								</li>
							{/each}
						</ol>
					</div>
				{/if}
			</section>
		</div>

		<aside class="stack" aria-labelledby="facts-heading">
			<section class="panel">
				<div class="panel__head"><Icon name="info" size={16} /><h2 id="facts-heading">Bank facts</h2></div>
				<dl class="panel__body facts">
					<dt>Date</dt>
					<dd>{txn.date}{txn.time ? ` ${txn.time}` : ''}</dd>
					<dt>Amount</dt>
					<dd>{txn.amount}</dd>
					<dt>Balance</dt>
					<dd>{txn.balance}</dd>
					<dt>Type</dt>
					<dd>{txn.transactionType || '—'}</dd>
					<dt>Pocket</dt>
					<dd>{txn.pocketName}</dd>
					<dt>Counterparty</dt>
					<dd>
						{txn.counterpartyDisplay.name}
						{#if txn.counterpartyDisplay.bankAccount}<span class="cell__sub">{txn.counterpartyDisplay.bankAccount}</span>{/if}
					</dd>
					<dt>Jago ID</dt>
					<dd class="mono">{txn.bankId || '—'}</dd>
					<dt>Responsible</dt>
					<dd>
						{txn.responsibleName ?? 'Unassigned'}
						{#if txn.responsibleInactive}<span class="cell__sub">No longer active</span>{/if}
					</dd>
				</dl>
				{#if txn.bankNotes.trim() !== ''}
					<div class="panel__body panel__body--ruled">
						<h3>Bank notes</h3>
						<p class="prose-block">{txn.bankNotes}</p>
					</div>
				{/if}
			</section>

			{#if txn.can.suppress}
				<section class="panel" aria-labelledby="suppress-heading">
					<div class="panel__head"><Icon name="bell" size={16} /><h2 id="suppress-heading">Notifications</h2></div>
					<div class="panel__body">
						{#if txn.suppressed}
							<p class="prose-block"><span class="muted">Suppressed:</span> {txn.suppressedReason}</p>
							<form method="POST" action="?/unsuppress" class="gap-top" use:submit>
								<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
								<input type="hidden" name="revision" value={txn.revision} />
								<button class="btn" type="submit">Resume</button>
							</form>
						{:else}
							<form method="POST" action="?/suppress" class="form" use:submit>
								<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
								<input type="hidden" name="revision" value={txn.revision} />
								<div class="field">
									<label for="suppress-reason">Reason <span class="req" aria-hidden="true">*</span></label>
									<input class="input" id="suppress-reason" name="reason" required />
								</div>
								<div class="form-actions">
									<button class="btn" type="submit">Suppress</button>
								</div>
							</form>
						{/if}
					</div>
				</section>
			{/if}
		</aside>
	</div>
</OrgShell>
