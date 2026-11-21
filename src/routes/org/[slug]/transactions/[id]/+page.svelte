<script lang="ts">
	import { fmtDateTime, parseRupiah, fmtMoney, rupiahInput } from '$lib/fmt';
	import Combobox from '$lib/components/ui/Combobox.svelte';
	import MoneyInput from '$lib/components/ui/MoneyInput.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Icon, { type IconName } from '$lib/components/Icon.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import RichComposer from '$lib/components/RichComposer.svelte';
	import { submit, unsavedGuard } from '$lib/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Shape as well as hue: the same icons as the ledger.
	const statusIcons: Record<string, IconName> = { needs: 'alert', review: 'history', approved: 'check', changes: 'close' };

	const txn = $derived(data.txn);
	const tone = $derived(txn.purposeReview ? txn.purposeReview.tone : txn.status === 'approved'
		? 'approved'
		: txn.status === 'changes_requested'
			? 'changes'
			: txn.needsDetails
				? 'needs'
				: 'review');

	interface AllocDraft {
		purpose: string;
		amount: string;
		member: string;
	}

	const draftOf = () => ({
		allocations: txn.allocations.map((allocation) => ({
			purpose: allocation.purposeName,
			amount: allocation.rupiah,
			member: allocation.overrideMemberId === null ? '' : String(allocation.overrideMemberId)
		})),
		responsible: txn.responsibleMemberId === null ? '' : String(txn.responsibleMemberId)
	});

	// Seeded at initialisation so the server-rendered form (and a no-JavaScript
	// submit) already carries the saved allocations.
	const initial = draftOf();
	let allocations = $state<AllocDraft[]>(initial.allocations);
	let responsible = $state(initial.responsible);
	let seededRevision: number | null = null;


	// Re-seed when the server hands back a new revision (an action reload).
	$effect(() => {
		const first = seededRevision === null;
		const changed = seededRevision !== txn.revision;
		seededRevision = txn.revision;
		if (first || !changed) return;
		const next = draftOf();
		allocations = next.allocations;
		responsible = next.responsible;
	});

	// The hint follows the draft being typed, not the saved allocations.
	const bankAbs = $derived(Math.abs(txn.amountMinor));
	const draftTotal = $derived.by(() => {
		let total = 0;
		for (const row of allocations) {
			if (row.purpose.trim() === '' && row.amount.trim() === '') continue;
			const minor = parseRupiah(row.amount);
			if (minor === null) return null;
			total += minor;
		}
		return total;
	});

	function addAllocation() {
		allocations = [...allocations, { purpose: '', amount: '', member: '' }];
	}
	function removeAllocation(index: number) {
		if (allocations.length <= 1) {
			allocations = [{ purpose: '', amount: '', member: '' }];
			return;
		}
		allocations = allocations.filter((_, i) => i !== index);
	}

	const statusLabel = $derived(
		txn.isIncome
			? txn.incomeComplete
				? 'Income noted'
				: 'Income notes needed'
			: txn.purposeReview
				? txn.purposeReview.label
				: txn.status === 'approved'
					? 'Approved'
					: txn.status === 'changes_requested'
						? 'Changes requested'
						: txn.needsDetails
							? 'Needs details'
							: 'Pending review'
	);

	const memberItems = $derived([
		{ value: '', label: txn.isIncome ? 'Not overridden' : 'Inherit' },
		...txn.members.map((member) => ({ value: String(member.id), label: member.name }))
	]);
	const purposeOptions = $derived(txn.purposes.map((purpose) => purpose.name));
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
			<span class="badge badge--{tone}"><Icon name={statusIcons[tone] ?? 'info'} size={12} />{statusLabel}</span>
			{#if txn.suppressed}<span class="badge badge--muted"><Icon name="bell" size={12} />Suppressed</span>{/if}
			<span>{fmtDateTime(txn.date, txn.time)}</span>
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
			{#if txn.can.incomeNotes}
				<section class="panel" aria-labelledby="explain-heading">
					<div class="panel__head">
						<Icon name="comment" size={16} />
						<h2 id="explain-heading">Income notes</h2>
					</div>
					<div class="panel__body">
						<form method="POST" action="?/details" class="form" use:submit use:unsavedGuard>
							<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
							<input type="hidden" name="revision" value={txn.revision} />
							<div class="field">
								<label for="explanation">Notes <span class="req" aria-hidden="true">*</span></label>
								<textarea class="input textarea" id="explanation" name="explanation" required>{txn.explanation}</textarea>
							</div>
							<div class="form-actions">
								<button class="btn btn--primary" type="submit"><Icon name="check" size={16} />Save notes</button>
							</div>
						</form>
					</div>
				</section>
			{:else if txn.explanation.trim() !== ''}
				<section class="panel" aria-labelledby="explain-heading">
					<div class="panel__head">
						<Icon name="comment" size={16} />
						<h2 id="explain-heading">Recorded notes</h2>
					</div>
					<div class="panel__body">
						<p class="prose-block">{txn.explanation}</p>
						{#if txn.evidenceUnavailableReason.trim() !== ''}
							<p class="prose-block muted">No supporting document: {txn.evidenceUnavailableReason}</p>
						{/if}
					</div>
				</section>
			{/if}

			<section class="panel" aria-labelledby="purposes-heading">
				<div class="panel__head">
					<Icon name="tag" size={16} />
					<h2 id="purposes-heading">Purposes</h2>
					{#if txn.allocations.length > 0}
						<span class="count">{txn.allocations.length}</span>
					{/if}
				</div>
				{#if txn.can.allocate}
					<div class="panel__body">
						<form method="POST" action="?/allocations" class="form" use:submit use:unsavedGuard>
							<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
							<input type="hidden" name="revision" value={txn.revision} />
							{#if !txn.isIncome}
								<div class="field">
									<label for="responsible">Inherited responsible member</label>
									<Select
										id="responsible"
										name="responsible_member_id"
										items={[{ value: '', label: 'None' }, ...txn.members.map((member) => ({ value: String(member.id), label: member.name }))]}
										bind:value={responsible}
									/>
									<p class="hint">Used by purposes without their own responsible members.</p>
								</div>
							{/if}
							{#if allocations.length === 0}
								<div class="field">
									<label for="quick-purpose">Purpose</label>
									<Combobox id="quick-purpose" name="quick_purpose" options={purposeOptions} maxlength={300} />
									<p class="hint">Choose an existing purpose or enter a new name. The full transaction amount is allocated.</p>
								</div>
								<div class="field">
									<label for="quick-notes">Description</label>
									<textarea class="input textarea" id="quick-notes" name="quick_notes" maxlength="16000" rows="3"></textarea>
								</div>
								<div class="field">
									<label for="quick-invoice">Invoice URL</label>
									<input class="input" id="quick-invoice" name="quick_invoice" type="url" maxlength="2000" />
									<p class="hint">Saved as a link in purpose notes, not as an uploaded document.</p>
								</div>
								<button class="btn btn--sm" type="button" onclick={() => { allocations = [{ purpose: '', amount: rupiahInput(bankAbs), member: '' }]; }}>Split across purposes</button>
							{:else}
							<fieldset class="form">
								<legend>Purpose allocations <span class="muted">({txn.kindLabel.toLowerCase()})</span></legend>
								<div class="split-head" aria-hidden="true">
									<span>Purpose</span>
									<span>Amount</span>
									<span>Handled by</span>
									<span></span>
								</div>
								{#each allocations as row, index (index)}
									<div class="split-row">
										<div class="field">
											<label class="visually-hidden" for="alloc-purpose-{index}">Purpose {index + 1}</label>
											<Combobox id="alloc-purpose-{index}" name="alloc_purpose[]" options={purposeOptions} bind:value={row.purpose} required maxlength={300} />
										</div>
										<div class="field">
											<label class="visually-hidden" for="alloc-amount-{index}">Amount {index + 1}</label>
											<MoneyInput id="alloc-amount-{index}" name="alloc_amount[]" bind:value={row.amount} required />
										</div>
										<div class="field">
											<label class="visually-hidden" for="alloc-member-{index}">Responsible override {index + 1}</label>
											<Select id="alloc-member-{index}" name="alloc_member[]" items={memberItems} bind:value={row.member} />
										</div>
										<button
											class="btn btn--sm row-action"
											type="button"
											aria-label="Remove purpose {index + 1}"
											onclick={() => removeAllocation(index)}
										>
											<Icon name="trash" size={16} />
										</button>
									</div>
								{/each}
								<div class="form-actions">
									<button class="btn btn--sm" type="button" aria-label="Add purpose" onclick={addAllocation}>
										<Icon name="plus" size={14} />Add
									</button>
								</div>
								<p class="hint" role="status">
									{#if draftTotal === null}
										Enter the unallocated amount as digits, for example {fmtMoney(bankAbs)}.
									{:else if bankAbs - draftTotal > 0}
										{fmtMoney(bankAbs - draftTotal)} remains unallocated
										{#if !txn.isIncome}(allowed while drafting; review needs the full amount){/if}.
									{:else if bankAbs - draftTotal === 0}
										Fully allocated{#if !txn.isIncome}; ready for purpose documentation{/if}.
									{:else}
										Allocations exceed the bank amount by {fmtMoney(draftTotal - bankAbs)}.
									{/if}
								</p>
							</fieldset>
							{/if}
							<div class="field">
								<RichComposer
									id="alloc-justification"
									name="justification"
									label="Justification (required when responsibility changes)"
									rows="2"
									maxlength={4000}
									placeholder="Required whenever responsibility changes; new responsibles and @mentions are emailed"
									members={txn.members}
								/>
							</div>
							<div class="form-actions">
								<button class="btn btn--primary" type="submit"><Icon name="check" size={16} />Save allocations</button>
							</div>
						</form>
						{#if txn.can.submit && !txn.isIncome}
							<form method="POST" action="?/submit" class="gap-top" use:submit>
								<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
								<input type="hidden" name="revision" value={txn.revision} />
								<button class="btn" type="submit"><Icon name="next" size={16} />Submit for purpose review</button>
							</form>
						{/if}
					</div>
				{:else if txn.allocations.length > 0}
					<ul class="rows">
						{#each txn.allocations as allocation (allocation.id)}
							<li>
								<details class="alloc">
									<summary>
										<span class="rows__main">
											<strong>{allocation.purposeName}</strong>
											<span class="rows__sub">
												{allocation.overrideName ? `Handled by ${allocation.overrideName}` : allocation.effectiveNames.length > 0 ? `Responsible: ${allocation.effectiveNames.join(', ')}` : 'No responsible member'}
											</span>
										</span>
										<span class="alloc__side">
											<span class="cell--nowrap">{allocation.amount}</span>
											<span class="badge badge--{allocation.statusTone}"><Icon name={statusIcons[allocation.statusTone] ?? 'info'} size={12} />{allocation.statusLabel}</span>
										</span>
									</summary>
									<div class="alloc__body">
										{#if allocation.notesPreview !== ''}
											<p class="rows__sub">{allocation.notesPreview}</p>
										{:else}
											<p class="rows__sub muted">No Notes yet.</p>
										{/if}
										<a class="row-button" href={allocation.url}>Open purpose<Icon name="next" size={14} /></a>
									</div>
								</details>
							</li>
						{/each}
					</ul>
					{#if txn.allocationTotals}
						<div class="panel__body panel__body--ruled">
							<p class="hint" role="status">
								{#if txn.allocationTotals.exact}
									Fully allocated.
								{:else}
									{txn.allocationTotals.remainder} remains unallocated.
								{/if}
							</p>
						</div>
					{/if}
				{:else}
					<div class="panel__body">
						<p class="muted">No purposes allocated yet.</p>
					</div>
				{/if}
			</section>

			{#if txn.evidence.length > 0 || (txn.can.upload && (txn.isIncome || txn.purposeReview === null))}
				<section class="panel" aria-labelledby="evidence-heading">
					<div class="panel__head">
						<Icon name="file" size={16} />
						<h2 id="evidence-heading">Documents</h2>
						{#if txn.evidence.length > 0}<span class="count">{txn.evidence.length}</span>{/if}
					</div>
					{#if txn.evidence.length > 0}
						<ul class="rows">
							{#each txn.evidence as document (document.id)}
								<li>
									<div class="rows__main">
										<a href={document.url}><Icon name="file" size={14} />{document.filename}</a>
										<span class="rows__sub">{document.sizeDisplay}{document.note ? ` · ${document.note}` : ''}</span>
									</div>
								</li>
							{/each}
						</ul>
					{/if}
					{#if txn.can.upload && (txn.isIncome || txn.purposeReview === null)}
						<div class="panel__body {txn.evidence.length > 0 ? 'panel__body--ruled' : ''}">
							<form method="POST" action="?/document" enctype="multipart/form-data" class="form form--inline" use:submit={{ reset: true }}>
								<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
								<input type="hidden" name="revision" value={txn.revision} />
								<div class="field">
									<label for="evidence-file">Document <span class="muted">(PDF, PNG, JPEG)</span></label>
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
			{/if}

			{#if txn.comments.length > 0 || txn.can.comment}
				<section class="panel" aria-labelledby="discussion-heading">
					<div class="panel__head">
						<Icon name="comment" size={16} />
						<h2 id="discussion-heading">Discussion</h2>
						{#if txn.comments.length > 0}<span class="count">{txn.comments.length}</span>{/if}
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
								<RichComposer
									id="comment-body"
									name="body"
									label="Comment"
									rows="3"
									required
									placeholder="Mention a member with @handle"
									members={txn.members}
								/>
								<div class="form-actions">
									<button class="btn" type="submit"><Icon name="comment" size={16} />Comment</button>
								</div>
							</form>
						</div>
					{/if}
				</section>
			{/if}

			{#if txn.audit.length > 0}
				<section class="panel" aria-labelledby="history-heading">
					<div class="panel__head">
						<Icon name="history" size={16} />
						<h2 id="history-heading">History</h2>
						<span class="count">{txn.audit.length}</span>
					</div>
					<div class="panel__body">
						<ol class="timeline">
							{#each txn.audit as entry, index (index)}
								<li>
									<p>
										<strong>{entry.authorName}</strong>
										<span class="muted"> · {entry.actionLabel} · {entry.createdAt}</span>
									</p>
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
				</section>
			{/if}
		</div>

		<aside class="stack" aria-labelledby="facts-heading">
			<section class="panel" aria-labelledby="tags-heading">
				<div class="panel__head"><Icon name="tag" size={16} /><h2 id="tags-heading">Tags</h2></div>
				<div class="panel__body">
					{#if data.tags.some((tag) => tag.assigned)}
						<ul class="rows">
							{#each data.tags.filter((tag) => tag.assigned) as tag (tag.id)}
								<li><span>{tag.name}</span>
									{#if data.canTag}<form method="POST" action="?/tag" use:submit><input type="hidden" name="csrf_token" value={data.shell.csrfToken} /><input type="hidden" name="revision" value={txn.revision} /><input type="hidden" name="remove_tag" value={tag.id} /><button class="btn btn--sm" type="submit" aria-label="Remove tag {tag.name}">Remove</button></form>{/if}
								</li>
							{/each}
						</ul>
					{:else}<p class="muted">No tags assigned.</p>{/if}
					{#if data.canTag}
						<form method="POST" action="?/tag" class="form gap-top" use:submit>
							<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
							<input type="hidden" name="revision" value={txn.revision} />
							<div class="field"><label for="transaction-tag">Add or create tag</label><input class="input" id="transaction-tag" name="tag" list="transaction-tag-options" maxlength="80" required /><datalist id="transaction-tag-options">{#each data.tags.filter((tag) => !tag.assigned) as tag (tag.id)}<option value={tag.name}></option>{/each}</datalist></div>
							<button class="btn" type="submit">Add tag</button>
						</form>
					{/if}
				</div>
			</section>
			<section class="panel">
				<div class="panel__head">
					<Icon name="info" size={16} />
					<h2 id="facts-heading">Facts</h2>
				</div>
				<dl class="panel__body facts">
					<dt>Date</dt>
					<dd>{fmtDateTime(txn.date, txn.time)}</dd>
					<dt>Amount</dt>
					<dd>{txn.amount}</dd>
					<dt>Balance after</dt>
					<dd>{txn.balance}</dd>
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
					<dt>Inherited responsible</dt>
					<dd>
						{txn.responsibleName ?? '—'}
						{#if txn.responsibleInactive}
							<span class="cell__sub">Inactive — reassign or give a purpose its own responsible member</span>
						{/if}
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
					<div class="panel__head">
						<Icon name="bell" size={16} />
						<h2 id="suppress-heading">Notifications</h2>
					</div>
					<div class="panel__body">
						{#if txn.suppressed}
							<p class="prose-block">
								<span class="muted">Suppressed: {txn.suppressedReason}</span>
							</p>
							<form method="POST" action="?/unsuppress" class="gap-top" use:submit>
								<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
								<input type="hidden" name="revision" value={txn.revision} />
								<button class="btn" type="submit">Resume notifications</button>
							</form>
						{:else}
							<form method="POST" action="?/suppress" class="form" use:submit>
								<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
								<input type="hidden" name="revision" value={txn.revision} />
								<div class="field">
									<label for="suppress-reason">
										Suppression reason <span class="req" aria-hidden="true">*</span>
									</label>
									<input class="input" id="suppress-reason" name="reason" required />
									<p class="hint">Stops notifications about this movement only; shared purposes keep their own discussion notices.</p>
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
