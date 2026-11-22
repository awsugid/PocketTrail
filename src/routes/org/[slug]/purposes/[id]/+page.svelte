<script lang="ts">
	import MemberPicker from '#lib/components/MemberPicker.svelte';
		import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import Icon, { type IconName } from '#lib/components/Icon.svelte';
	import MarkdownView from '#lib/components/MarkdownView.svelte';
	import EvidenceGallery from '#lib/components/EvidenceGallery.svelte';
	import { page } from '$app/state';
	import Notice from '#lib/components/Notice.svelte';
	import OrgShell from '#lib/components/OrgShell.svelte';
	import PageHead from '#lib/components/PageHead.svelte';
	import DiscussionPanel from '#lib/components/DiscussionPanel.svelte';
	import RichComposer from '#lib/components/RichComposer.svelte';
	import { submit, unsavedGuard } from '#lib/forms.ts';
	import { fmtDate } from '#lib/fmt.ts';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();

	const purpose = $derived(data.purpose);
	const base = $derived(`/org/${data.shell.org.slug}/purposes`);
	const statusIcons: Record<string, IconName> = { needs: 'alert', review: 'history', approved: 'check', changes: 'close' };

	let responsible = $state<string[]>([]);
	let seeded: number | undefined;
	let editingNotes = $state(false), uploading = $state(false), assigning = $state(false);
	let review = $state<'approve' | 'requestChanges' | null>(null);
	const tabs = ['evidence', 'transactions', 'notes', 'history'] as const;
	const tab = $derived(tabs.find((item) => item === page.url.searchParams.get('tab')) ?? 'evidence');
	// Seed the picker from the loaded purpose, and re-seed when an
	// action reload hands back a fresh revision.
	$effect(() => {
		if (purpose.revision !== seeded) {
			responsible = purpose.responsibles.map((member) => String(member.id));
			seeded = purpose.revision;
		}
	});
	const chatOpen = $derived(page.url.searchParams.get('chat') === '1' || page.url.searchParams.get('tab') === 'discussion');
	function sectionHref(nextTab: string | null = null, open = chatOpen) {
		const url = new URL(page.url.href);
		if (nextTab) url.searchParams.set('tab', nextTab);
		else if (url.searchParams.get('tab') === 'discussion') url.searchParams.delete('tab');
		if (open) url.searchParams.set('chat', '1');
		else url.searchParams.delete('chat');
		return url.pathname + url.search + url.hash;
	}

</script>

<svelte:head>
	<title>{purpose.name} · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="purposes">
	<div class="detail-workspace">
		<div class="purpose-main">
	<div class="purpose-header"><PageHead title={purpose.name} back={{ href: base, label: 'Purposes' }}>
		{#snippet actions()}
			<p class="amount-total" class:amount--in={purpose.kind === 'income'}>{purpose.total}</p>
		{/snippet}
		{#snippet meta()}
			<span class="badge badge--muted">{purpose.kindLabel}</span>
			<span class="badge badge--{purpose.statusTone}">
				<Icon name={statusIcons[purpose.statusTone] ?? 'info'} size={12} />{purpose.statusLabel}
			</span>
			{#if purpose.responsibles.length > 0}
				<span>{purpose.responsibles.map((member) => member.name).join(', ')}</span>
			{/if}
		{/snippet}
	</PageHead>

		<div class="header-actions">
		{#if purpose.can.assign}<button class="btn" type="button" aria-expanded={assigning} onclick={() => assigning = !assigning}>Change responsible members</button>{/if}
		{#if purpose.approval.eligible && purpose.can.approve}<button class="btn" type="button" aria-expanded={review === 'approve'} onclick={() => review = review === 'approve' ? null : 'approve'}>Approve</button>{/if}
		{#if purpose.approval.eligible && purpose.can.requestChanges}<button class="btn" type="button" aria-expanded={review === 'requestChanges'} onclick={() => review = review === 'requestChanges' ? null : 'requestChanges'}>Request changes</button>{/if}</div>
		{#if !purpose.ready}<Notice tone="warning">Needed before review: {purpose.kind === 'expense' ? 'evidence or Notes' : 'Notes'} recording this purpose.</Notice>{/if}

	{#if data.msg}
		<Notice tone="success">{data.msg}</Notice>
	{/if}

		{#if assigning && purpose.can.assign}<div class="panel assignment"><form method="POST" action="?/responsibles" class="form" use:submit use:unsavedGuard>
							<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
							<input type="hidden" name="revision" value={purpose.revision} />
							<div class="field">
															<Label for="purpose-responsibles">Responsible members <span class="req" aria-hidden="true">*</span></Label>
															<MemberPicker id="purpose-responsibles" name="responsible_id[]" members={purpose.members}
																multiple placeholder="Select members" bind:value={responsible} />
														</div>
							<div class="field">
								<Label for="responsible-justification">
									Justification <span class="req" aria-hidden="true">*</span>
									<span class="muted"> — logged permanently in the discussion and history; new responsibles and @mentions are emailed</span>
								</Label>
								<RichComposer
									id="responsible-justification"
									name="justification"
									label="Reassignment justification"
									rows={2}
									required
									maxlength={4000}
									placeholder="Why responsibility changes"
									members={purpose.members}
								/>
							</div>
							<div class="form-actions">
								<Button class="" type="submit" variant="default"><Icon name="check" size={16} />Save responsibility</Button>
							</div>
						</form></div>{/if}
		<div class="review-area">{#if purpose.kind === 'expense'}
				<section class="panel" aria-labelledby="review-heading">
					<div class="panel__head">
						<Icon name="check" size={16} />
						<h2 id="review-heading">Review</h2>
					</div>
					<div class="panel__body stack">
						{#if data.exemption}
							<div class="stack">
								<p><span class="badge badge--muted"><Icon name="history" size={12} />Historical exemption</span></p>
								<p class="muted">Excluded from the approval queue, not marked approved.</p>
								<dl class="historical-facts"><dt>Sheet reference</dt><dd>{data.exemption.source_reference}</dd><dt>Reason</dt><dd>{data.exemption.reason}</dd></dl>
								{#if data.historicalAdmin}<form method="POST" action="?/revokeExemption" use:submit={{ confirm: 'Remove this historical exemption? This purpose returns to normal approval rules.', confirmLabel: 'Remove exemption' }}><input type="hidden" name="csrf_token" value={data.shell.csrfToken} /><Button class="" type="submit" variant="outline" size="sm">Remove exemption</Button></form>{/if}
							</div>
						{/if}
						{#if purpose.status === 'approved'}
							<p><strong>Approved</strong>{purpose.approvedByName ? ` by ${purpose.approvedByName}` : ''}{purpose.approvedAt ? ` · ${purpose.approvedAt}` : ''}</p>
							{#if purpose.approvalNote.trim() !== ''}
								<p class="prose-block">{purpose.approvalNote}</p>
							{/if}
						{:else if purpose.status === 'changes_requested'}
							<p><strong>Changes requested</strong></p>
						{:else if purpose.status === 'submitted'}
							<p class="muted">Awaiting review.</p>
						{:else}
							<p class="muted">Documentation is completed from the transaction before review.</p>
						{/if}
						{#if purpose.can.approve || purpose.can.requestChanges}
							{#if purpose.approval.eligible}
								{#if review === 'approve'}<form method="POST" action="?/approve" class="form form--inline" use:submit>
									<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
									<input type="hidden" name="revision" value={purpose.revision} />
									<div class="field">
										<Label for="approve-note">Note</Label>
										<Input class="" id="approve-note" name="note" />
									</div>
									<Button class="" type="submit" variant="default"><Icon name="check" size={16} />Approve</Button>
								</form>{/if}
								{#if review === 'requestChanges'}<form method="POST" action="?/requestChanges" class="form form--inline" use:submit>
									<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
									<input type="hidden" name="revision" value={purpose.revision} />
									<div class="field">
										<Label for="changes-note">What changes <span class="req" aria-hidden="true">*</span></Label>
										<Input class="" id="changes-note" name="note" required />
									</div>
									<Button class="" type="submit" variant="outline"><Icon name="alert" size={16} />Request changes</Button>
								</form>{/if}
							{/if}
						{/if}
						{#if data.historicalAdmin && !data.exemption}
							<details class="fold historical" open={!!form?.historicalError}>
								<summary>Mark as historical</summary>
								<form method="POST" action="?/exempt" class="form historical-form">
									<p class="hint">Skip approval for this purpose only after verifying its historical Sheet record. Notes and unconfirmed mappings stay unchanged.</p>
									{#if form?.historicalError}<div role="alert"><Notice tone="warning">{form.historicalError}</Notice></div>{/if}
									<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
									<input type="hidden" name="revision" value={purpose.revision} />
									<div class="field"><Label for="historical-source">Sheet reference <span class="req" aria-hidden="true">*</span></Label><Input class="" id="historical-source" name="source_reference" required maxlength={2000} placeholder="Sheet name, tab and row" value={form?.source ?? ''} /></div>
									<div class="field"><Label for="historical-reason">Why approval is not needed <span class="req" aria-hidden="true">*</span></Label><Textarea class="" id="historical-reason" name="reason" required maxlength={2000} rows={3} value={form?.reason ?? ''}></Textarea></div>
									<Label class="check historical-confirm" for="historical-confirm"><Checkbox id="historical-confirm" name="confirmed" value="yes" required /><span>I verified this exact Sheet record matches this purpose.</span></Label>
									<div class="form-actions"><Button class="" type="submit" variant="outline"><Icon name="history" size={16} />Save historical exemption</Button></div>
								</form>
							</details>
						{/if}
					</div>
				</section>
			{/if}

	</div>
	</div>
	<div class="stack detail-content">
		<nav class="purpose-tabs" aria-label="Purpose sections">{#each tabs as item}<a href={sectionHref(item)} data-sveltekit-noscroll data-sveltekit-replacestate aria-current={tab === item ? 'page' : undefined}>{item.charAt(0).toUpperCase() + item.slice(1)}{item === 'evidence' ? ` (${purpose.evidence.length})` : item === 'transactions' ? ` (${purpose.allocations.length})` : item === 'history' ? ` (${purpose.audit.length})` : ''}</a>{/each}</nav>

			{#if tab === 'transactions'}<section class="panel" aria-labelledby="allocations-heading">
				<div class="panel__head">
					<Icon name="ledger" size={16} />
					<h2 id="allocations-heading">Transactions</h2>
					<span class="count">{purpose.allocations.length}</span>
				</div>
				{#if purpose.allocations.length > 0}
					<ul class="rows rows--link">
						{#each purpose.allocations as allocation (allocation.txnId)}
							<li>
								<a href={allocation.url}>
									<span class="lead">
										<span class="rows__main">
											<strong>{allocation.counterparty}</strong>
											<span class="rows__sub">
												{fmtDate(allocation.date)}{allocation.time ? ` · ${allocation.time}` : ''} · {allocation.pocketName}
												{#if allocation.bankId} · <span class="mono">{allocation.bankId}</span>{/if}
											</span>
											<span class="rows__sub">
												{allocation.overrideName ? `Handled by ${allocation.overrideName}` : `Responsible: ${allocation.effectiveNames.join(', ')}`}
											</span>
										</span>
									</span>
									<span class="tail">
										<span class="cell--nowrap" class:amount--in={allocation.isIncome}>{allocation.amount}</span>
									</span>
								</a>
							</li>
						{/each}
					</ul>
				{:else}
					<div class="panel__body">
						<p class="muted">No bank transaction allocates to this purpose yet. Allocate from a transaction's purpose list.</p>
					</div>
				{/if}
			</section>

			{/if}{#if tab === 'notes'}<section class="panel" aria-labelledby="notes-heading">
				<div class="panel__head">
					<Icon name="comment" size={16} />
					<h2 id="notes-heading">Notes</h2>
					{#if purpose.status === 'approved' && purpose.can.editNotes}
						<span class="badge badge--changes">Editing reopens review</span>
					{/if}
				</div>
				<div class="panel__body stack">
					{#if purpose.notes.trim() !== ''}
						<MarkdownView source={purpose.notes} />
					{:else}
						<p class="muted">No Notes yet.{#if purpose.kind === 'expense'} Evidence or Notes must record the missing-evidence outcome when no document exists.{/if}</p>
					{/if}
					{#if purpose.can.editNotes}
						<button class="btn" type="button" aria-expanded={editingNotes} onclick={() => editingNotes = !editingNotes}>{editingNotes ? 'Cancel' : 'Edit'}</button>{#if editingNotes}<form method="POST" action="?/notes" class="form" use:submit use:unsavedGuard>
							<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
							<input type="hidden" name="revision" value={purpose.revision} />
							<RichComposer
								id="purpose-notes"
								name="notes"
								label="Purpose Notes"
								initial={purpose.notes}
								rows={5}
								placeholder="What this purpose covers; when evidence is missing, say why here"
								members={purpose.members}
								hint="Markdown: **bold**, *italic*, lists, quotes, code, links. @handle mentions."
							/>
							<div class="form-actions">
								<Button class="" type="submit" variant="default"><Icon name="check" size={16} />Save Notes</Button>
							</div>
						</form>{/if}
					{/if}
				</div>
			</section>

			{/if}{#if tab === 'evidence'}<section class="panel" aria-labelledby="evidence-heading">
				<div class="panel__head">
					<Icon name="file" size={16} />
					<h2 id="evidence-heading">Evidence</h2>
					{#if purpose.can.upload}<button class="btn" type="button" aria-expanded={uploading} onclick={() => uploading = !uploading}>{uploading ? 'Cancel' : '+ Upload'}</button>{/if}</div>
<div class="panel__body"><EvidenceGallery items={purpose.evidence} emptyText="No documents. Notes can record why evidence is unavailable." /></div>
{#if purpose.can.upload && uploading}
					<div class="panel__body {purpose.evidence.length > 0 ? 'panel__body--ruled' : ''}">
						<form method="POST" action="?/evidence" enctype="multipart/form-data" class="form form--inline" use:submit={{ reset: true }}>
							<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
							<input type="hidden" name="revision" value={purpose.revision} />
							<div class="field">
								<Label for="evidence-file">Document <span class="muted">(PDF, PNG, JPEG)</span></Label>
								<Input class="" id="evidence-file" name="file" type="file" accept="application/pdf,image/png,image/jpeg" required />
							</div>
							<div class="field">
								<Label for="evidence-note">Note</Label>
								<Input class="" id="evidence-note" name="note" />
							</div>
							<Button class="" type="submit" variant="outline"><Icon name="upload" size={16} />Attach</Button>
						</form>
					</div>
				{/if}
			</section>{/if}

			{#if tab === 'history' && purpose.audit.length > 0}
				<section class="panel" aria-labelledby="history-heading">
					<div class="panel__head">
						<Icon name="history" size={16} />
						<h2 id="history-heading">History</h2>
						<span class="count">{purpose.audit.length}</span>
					</div>
					<div class="panel__body">
						<ol class="timeline">
							{#each purpose.audit as entry, index (index)}
								<li>
									<p>
										<strong>{entry.authorName}</strong>
										<span class="muted"> · {entry.actionLabel} · {entry.createdAt}</span>
									</p>
									{#if entry.detail !== ''}
										<p class="rows__sub">{entry.detail}</p>
									{/if}
								</li>
							{/each}
						</ol>
					</div>
				</section>
			{/if}
		<section class="purpose-info panel" aria-label="Purpose information"><h2>Info</h2><dl><dt>Created</dt><dd>{purpose.createdAt} by {purpose.creatorName}</dd><dt>Updated</dt><dd>{purpose.updatedAt}</dd>{#if purpose.sourceSplit}<dt>Source split</dt><dd><a href={purpose.sourceSplit.url}>{purpose.sourceSplit.label} (#{purpose.sourceSplit.id})</a></dd>{/if}{#if purpose.suppressed}<dt>Suppression</dt><dd>By {purpose.suppressedByName ?? 'Unknown'} · {purpose.suppressedAt ?? 'Unknown date'}<br />{purpose.suppressedReason}</dd>{/if}</dl></section></div>
		</div>
		<DiscussionPanel open={chatOpen} openHref={sectionHref(null, true)} closeHref={sectionHref(null, false)} messages={purpose.messages.map(m => ({ ...m, author: m.authorHandle, body: m.bodyMd }))}>
			{#snippet composer()}
				{#if purpose.can.comment}
					<form method="POST" action="?/message" use:submit={{ reset: true }}>
						<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
						<RichComposer id="discussion-message" name="body" label="Discussion message" variant="compact" required placeholder="Write a message… @handle to mention" members={purpose.members} />
					</form>
				{/if}
			{/snippet}
		</DiscussionPanel>
</div>
</OrgShell>

<style>
	.historical { border-top: 1px solid var(--border); padding-top: 16px; }
	.historical-form { margin-top: 16px; max-width: 560px; }
	.historical-confirm { align-items: flex-start; line-height: 1.5; }
	
	.historical-confirm span, .historical-facts dd { min-width: 0; overflow-wrap: anywhere; }
	.historical-facts { display: grid; gap: 4px; margin: 0; }
	.historical-facts dt { font-weight: 600; }
	.historical-facts dd { margin: 0 0 8px; }

	.purpose-header { position: sticky; top: var(--topbar-h); z-index: 3; background: var(--bg); padding: 4px 0; border-bottom: 1px solid var(--border); }
	.header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
	.assignment, .review-area { max-width: 640px; margin-top: 12px; }
	.assignment { padding: 16px; }
	.purpose-tabs { display: flex; overflow-x: auto; white-space: nowrap; gap: 16px; padding: 4px 0; }
	.purpose-tabs a { padding: 8px 4px; border-bottom: 2px solid transparent; }
	.purpose-tabs a[aria-current="page"] { border-color: var(--accent); font-weight: 650; }
	.purpose-info { padding: 16px; overflow-wrap: anywhere; }
	.purpose-info h2 { font-size: 16px; margin: 0 0 12px; }
	.purpose-info dl { margin: 0; }
	.purpose-info dt { color: var(--muted); margin-top: 12px; }
	.purpose-info dd { margin: 2px 0 0; }

	.purpose-main { min-width: 0; }
	.purpose-tabs a { text-transform: capitalize; }
	.purpose-info dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 16px; }
	.purpose-info dt, .purpose-info dd { margin: 0; }
	.detail-content { gap: 12px; }
	.detail-workspace { padding-bottom: calc(88px + env(safe-area-inset-bottom)); }
	.detail-workspace :global(.page-head) { margin-bottom: 8px; gap: 4px 12px; }
	.detail-workspace :global(.panel__head), .detail-workspace :global(.panel__body) { padding: 10px 12px; }
	.detail-workspace :global(td), .detail-workspace :global(th) { padding-block: 8px; }
	.detail-workspace :global(.empty) { padding: 12px; }
</style>
