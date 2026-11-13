<script lang="ts">
	import { enhance } from '$app/forms';
	import OrgShell from '$lib/components/OrgShell.svelte';
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

	let splits = $state<SplitDraft[]>([]);
	let responsible = $state('');
	let seededRevision = -1;

	// Re-seed the editable draft whenever the server hands back a new revision
	// (an action reload), never on unrelated reactive reads.
	$effect(() => {
		if (seededRevision === txn.revision) return;
		seededRevision = txn.revision;
		splits = txn.splits.map((split) => ({
			label: split.label,
			amount: split.rupiah,
			member: split.responsibleMemberId === null ? '' : String(split.responsibleMemberId)
		}));
		responsible = txn.responsibleMemberId === null ? '' : String(txn.responsibleMemberId);
	});

	function addSplit() {
		splits = [...splits, { label: '', amount: '', member: responsible }];
	}
	function removeSplit(index: number) {
		if (splits.length <= 1) return;
		splits = splits.filter((_, i) => i !== index);
	}
</script>

<svelte:head>
	<title>{txn.counterpartyDisplay.name} · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="transactions">
	<p class="back">
		<a href="/org/{data.shell.org.slug}/transactions">← Ledger</a>
	</p>

	{#if data.msg}
		<p class="notice" role="status">{data.msg}</p>
	{/if}

	<div class="page-head">
		<div>
			<h1>{txn.counterpartyDisplay.name}</h1>
			<p class="meta-line">
				<span>{txn.date}{txn.time ? ` ${txn.time}` : ''}</span>
				<span>{txn.transactionType || 'Movement'}</span>
				<span>{txn.pocketName}</span>
				<span class="badge badge--{tone}">
					{txn.isIncome
						? txn.incomeComplete
							? 'Income noted'
							: 'Income notes needed'
						: txn.status === 'approved'
							? 'Approved'
							: txn.status === 'changes_requested'
								? 'Changes requested'
								: txn.needsDetails
									? 'Needs details'
									: 'Pending review'}
				</span>
				{#if txn.suppressed}<span class="badge badge--muted">Notifications suppressed</span>{/if}
			</p>
		</div>
		<p class="amount-total" class:amount--in={txn.amountMinor > 0}>{txn.amount}</p>
	</div>

	{#if txn.missing.length > 0 && !txn.isIncome}
		<div class="notice" role="status">
			<p style="margin: 0 0 4px"><strong>Still needed before review:</strong></p>
			<ul style="margin: 0; padding-left: 1.2em">
				{#each txn.missing as item (item)}
					<li>{item}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="detail-grid">
		<div>
			<!-- Explanation / income notes: the primary task of this page. -->
			<section class="detail-section" aria-labelledby="explain-heading">
				<h2 id="explain-heading">{txn.isIncome ? 'Income notes' : 'Explanation'}</h2>
				{#if !txn.can.edit && !txn.can.incomeNotes}
					{#if txn.explanation.trim() !== ''}
						<p class="prose-block">{txn.explanation}</p>
					{:else}
						<p class="muted">No explanation has been recorded yet.</p>
					{/if}
				{:else}
					<form method="POST" action="?/details" use:enhance class="stack-form">
						<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
						<input type="hidden" name="revision" value={txn.revision} />
						<div class="field">
							<label for="explanation">{txn.isIncome ? 'Notes' : 'Explanation'}
								{#if txn.isIncome}<span class="muted">(required, written by you)</span>{/if}
							</label>
							<textarea class="input textarea" id="explanation" name="explanation" required
								>{txn.explanation}</textarea>
							<p class="hint">
								{txn.isIncome
									? 'Income needs member-authored notes. No approval is involved.'
									: 'What was this money for? Substantive edits reopen review.'}
							</p>
						</div>

						{#if !txn.isIncome && txn.can.edit}
							<div class="field">
								<label for="responsible">Responsible member</label>
								<select class="select" id="responsible" name="responsible_member_id" required bind:value={responsible}>
									<option value="">Choose a member</option>
									{#each txn.members as member (member.id)}
										<option value={String(member.id)}>{member.name}</option>
									{/each}
								</select>
							</div>

							<fieldset class="purposes">
								<legend>Purposes</legend>
								<p class="hint">
									Positive IDR amounts that add up to {txn.amountMagnitudeMinor === 0
										? 'the bank amount'
										: txn.totals?.amountMinor !== undefined
											? txn.totals.amountMinor / 100
											: ''}. Each purpose may name its own responsible member.
								</p>
								{#each splits as row, index (index)}
									<div class="split-row">
										<div class="field">
											<label for="split-label-{index}">Purpose {index + 1}</label>
											<input class="input" id="split-label-{index}" name="split_label[]" bind:value={row.label} required />
										</div>
										<div class="field">
											<label for="split-amount-{index}">Amount (IDR)</label>
											<input class="input" id="split-amount-{index}" name="split_amount[]" inputmode="decimal"
												bind:value={row.amount} required />
										</div>
										<div class="field">
											<label for="split-member-{index}">Responsible</label>
											<select class="select" id="split-member-{index}" name="split_member[]" bind:value={row.member} required>
												<option value="">Choose a member</option>
												{#each txn.members as member (member.id)}
													<option value={String(member.id)}>{member.name}</option>
												{/each}
											</select>
										</div>
										<button class="btn btn--quiet split-remove" type="button" onclick={() => removeSplit(index)}
											disabled={splits.length <= 1}>Remove</button
										>
									</div>
								{/each}
								<button class="btn" type="button" onclick={addSplit}>Add a purpose</button>
								{#if txn.totals}
									<p class="hint" role="status">
										Saved purposes total {txn.totals.splitTotalMinor === txn.totals.amountMinor
											? 'the bank amount'
											: 'a different amount than the bank record'}.
									</p>
								{/if}
							</fieldset>

							<div class="field">
								<label for="reason">Document-unavailable reason <span class="muted">(optional)</span></label>
								<input class="input" id="reason" name="evidence_unavailable_reason"
									value={txn.evidenceUnavailableReason} />
								<p class="hint">Record this instead of attaching a document when none exists.</p>
							</div>
						{/if}

						<button class="btn btn--primary" type="submit">
							{txn.isIncome ? 'Save notes' : 'Save details'}
						</button>
					</form>
				{/if}
			</section>

			{#if !txn.isIncome}
				<section class="detail-section" aria-labelledby="purposes-heading">
					<h2 id="purposes-heading">Purposes</h2>
					{#if txn.splits.length > 0}
						<ul class="plain-list">
							{#each txn.splits as split (split.label + split.amountMinor)}
								<li>
									{split.label} — {split.amount}
									{#if split.responsibleName}
										<span class="cell__sub">Responsible: {split.responsibleName}</span>
									{/if}
								</li>
							{/each}
						</ul>
						{#if txn.totals}
							<p class="hint">
								Bank amount {txn.amount} · purposes total
								{txn.totals.splitTotalMinor === txn.totals.amountMinor ? 'match' : 'do not match'}.
							</p>
						{/if}
					{:else}
						<p class="muted">This movement is recorded as a single purpose.</p>
					{/if}
				</section>
			{/if}

			<section class="detail-section" aria-labelledby="evidence-heading">
				<h2 id="evidence-heading">Evidence</h2>
				{#if txn.evidence.length > 0}
					<ul class="evidence-list">
						{#each txn.evidence as document (document.id)}
							<li>
								<a href={document.url}>{document.filename}</a>
								<span class="cell__sub">{document.sizeDisplay}{document.note ? ` · ${document.note}` : ''}</span>
							</li>
						{/each}
					</ul>
				{:else if txn.evidenceUnavailableReason.trim() !== ''}
					<p>
						No document attached. Reason recorded:
						<span class="prose-block">{txn.evidenceUnavailableReason}</span>
					</p>
				{:else}
					<p class="muted">No supporting document and no stated reason yet.</p>
				{/if}

				{#if txn.can.upload}
					<form method="POST" action="?/document" enctype="multipart/form-data" use:enhance class="stack-form compact">
						<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
						<input type="hidden" name="revision" value={txn.revision} />
						<div class="field">
							<label for="evidence-file">Attach evidence <span class="muted">(PDF, PNG, or JPEG up to 10 MB)</span></label>
							<input class="input" id="evidence-file" name="file" type="file" accept="application/pdf,image/png,image/jpeg" required />
						</div>
						<div class="field">
							<label for="evidence-note">Document note <span class="muted">(optional)</span></label>
							<input class="input" id="evidence-note" name="note" />
						</div>
						<button class="btn" type="submit">Attach document</button>
					</form>
				{/if}
			</section>

			{#if !txn.isIncome}
				<section class="detail-section" aria-labelledby="review-heading">
					<h2 id="review-heading">Review</h2>
					{#if txn.reviewDecision}
						<p>
							<strong>{txn.reviewDecision.statusLabel}</strong>
							by {txn.reviewDecision.authorName} · {txn.reviewDecision.createdAt}
							{#if txn.reviewDecision.note.trim() !== ''}
								<span class="prose-block">{txn.reviewDecision.note}</span>
							{/if}
						</p>
					{:else if txn.status === 'approved'}
						<p>Approved.</p>
					{:else}
						<p class="muted">Awaiting review.</p>
					{/if}

					{#if txn.can.approve}
						{#if txn.approval.eligible}
							<div class="review-forms">
								<form method="POST" action="?/approve" use:enhance class="stack-form compact">
									<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
									<input type="hidden" name="revision" value={txn.revision} />
									<div class="field">
										<label for="approve-note">Approval note <span class="muted">(optional)</span></label>
										<input class="input" id="approve-note" name="note" />
									</div>
									<button class="btn btn--primary" type="submit">Approve</button>
								</form>
								<form method="POST" action="?/requestChanges" use:enhance class="stack-form compact">
									<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
									<input type="hidden" name="revision" value={txn.revision} />
									<div class="field">
										<label for="changes-note">What needs changing? <span class="muted">(required)</span></label>
										<input class="input" id="changes-note" name="note" required />
									</div>
									<button class="btn" type="submit">Request changes</button>
								</form>
							</div>
						{:else}
							<p class="muted">{txn.approval.ineligibleReason ?? 'You cannot decide this transaction.'}</p>
						{/if}
					{/if}

					{#if txn.can.submit}
						<form method="POST" action="?/submit" use:enhance class="stack-form compact">
							<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
							<input type="hidden" name="revision" value={txn.revision} />
							<button class="btn" type="submit">Resubmit for review</button>
						</form>
					{/if}
				</section>
			{/if}

			<section class="detail-section" aria-labelledby="discussion-heading">
				<h2 id="discussion-heading">Discussion</h2>
				{#if txn.comments.length === 0}
					<p class="muted">No comments yet.</p>
				{:else}
					<ol class="comment-list">
						{#each txn.comments as comment, index (index)}
							<li>
								<p class="comment-meta">{comment.authorName} · {comment.createdAt}</p>
								<p class="prose-block">{comment.body}</p>
							</li>
						{/each}
					</ol>
				{/if}

				{#if txn.can.comment}
					<form method="POST" action="?/comment" use:enhance class="stack-form compact">
						<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
						<div class="field">
							<label for="comment-body">Add a comment</label>
							<textarea class="input textarea" id="comment-body" name="body" rows="3" required></textarea>
							<p class="hint">Mention a member with @handle. Comments never change the approval.</p>
						</div>
						<button class="btn" type="submit">Post comment</button>
					</form>
				{/if}
			</section>

			<section class="detail-section" aria-labelledby="history-heading">
				<h2 id="history-heading">History</h2>
				{#if txn.audit.length === 0}
					<p class="muted">No recorded changes yet.</p>
				{:else}
					<ol class="audit-list">
						{#each txn.audit as entry, index (index)}
							<li>
								<p class="audit-meta">
									<strong>{entry.authorName}</strong> · {entry.createdAt} · {entry.actionLabel}
								</p>
								{#if entry.previousLabel !== entry.newLabel}
									<p class="audit-facts">{entry.previousLabel} → {entry.newLabel}</p>
								{/if}
								{#if entry.facts.length > 0}
									<ul class="audit-facts">
										{#each entry.facts as fact, index (index)}
											<li><span class="muted">{fact[0]}:</span> {fact[1]}</li>
										{/each}
									</ul>
								{/if}
							</li>
						{/each}
					</ol>
				{/if}
			</section>
		</div>

		<aside class="rail" aria-labelledby="facts-heading">
			<h2 id="facts-heading">Bank facts</h2>
			<dl class="facts">
				<dt>Date</dt>
				<dd>{txn.date}{txn.time ? ` ${txn.time}` : ''}</dd>
				<dt>Amount</dt>
				<dd>{txn.amount}</dd>
				<dt>Balance after</dt>
				<dd>{txn.balance}</dd>
				<dt>Type</dt>
				<dd>{txn.transactionType || '—'}</dd>
				<dt>Pocket</dt>
				<dd>{txn.pocketName}</dd>
				<dt>Counterparty</dt>
				<dd>
					{txn.counterpartyDisplay.name}
					{#if txn.counterpartyDisplay.bankAccount}
						<span class="cell__sub">{txn.counterpartyDisplay.bankAccount}</span>
					{/if}
				</dd>
				<dt>Jago ID</dt>
				<dd class="mono">{txn.bankId || '—'}</dd>
				<dt>Responsible</dt>
				<dd>
					{txn.responsibleName ?? 'Unassigned'}
					{#if txn.responsibleInactive}<span class="cell__sub">No longer an active member</span>{/if}
				</dd>
			</dl>

			{#if txn.bankNotes.trim() !== ''}
				<h2 class="rail-heading">Bank notes</h2>
				<p class="prose-block">{txn.bankNotes}</p>
			{/if}

			{#if txn.can.suppress}
				<h2 class="rail-heading">Notifications</h2>
				{#if txn.suppressed}
					<p>
						Suppressed: <span class="prose-block">{txn.suppressedReason}</span>
					</p>
					<form method="POST" action="?/unsuppress" use:enhance>
						<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
						<input type="hidden" name="revision" value={txn.revision} />
						<button class="btn" type="submit">Resume notifications</button>
					</form>
				{:else}
					<form method="POST" action="?/suppress" use:enhance class="stack-form compact">
						<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
						<input type="hidden" name="revision" value={txn.revision} />
						<div class="field">
							<label for="suppress-reason">Suppression reason <span class="muted">(required)</span></label>
							<input class="input" id="suppress-reason" name="reason" required />
							<p class="hint">Cancels queued mentions and digests about this movement. It never changes approval.</p>
						</div>
						<button class="btn" type="submit">Suppress notifications</button>
					</form>
				{/if}
			{/if}
		</aside>
	</div>
</OrgShell>

<style>
	.back {
		margin: 0 0 8px;
	}
	.amount-total {
		margin: 0;
		font-size: 22px;
		font-weight: 650;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
	}
	.stack-form {
		display: flex;
		flex-direction: column;
		gap: 14px;
		max-width: 560px;
		margin-top: 12px;
	}
	.stack-form.compact {
		gap: 10px;
		margin-top: 10px;
	}
	.textarea {
		width: 100%;
		min-height: 96px;
		resize: vertical;
	}
	.hint {
		margin: 4px 0 0;
		font-size: 12px;
		color: var(--text-secondary);
	}
	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 12px;
	}
	.purposes {
		border: 0;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.purposes legend {
		padding: 0;
		font-weight: 600;
		font-size: 13px;
	}
	.split-row {
		display: grid;
		gap: 8px;
		align-items: end;
		padding-bottom: 10px;
		border-bottom: 1px solid var(--border);
	}
	@media (min-width: 720px) {
		.split-row {
			grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1.4fr) auto;
		}
	}
	.split-remove {
		align-self: end;
	}
	.review-forms {
		display: grid;
		gap: 18px;
		margin-top: 12px;
	}
	@media (min-width: 960px) {
		.review-forms {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
	}
	.evidence-list,
	.comment-list,
	.audit-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.comment-list li,
	.audit-list li {
		border-left: 2px solid var(--border);
		padding-left: 12px;
	}
	.comment-meta,
	.audit-meta {
		margin: 0 0 2px;
		font-size: 12px;
		color: var(--text-secondary);
	}
	.audit-facts {
		margin: 2px 0 0;
		padding-left: 1.1em;
		font-size: 13px;
	}
	.rail-heading {
		margin-top: 20px;
	}
</style>
