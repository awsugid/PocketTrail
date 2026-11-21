<script lang="ts">
 import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Button } from '$lib/components/ui/button';
	import Icon, { type IconName } from '$lib/components/Icon.svelte';
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import RichComposer from '$lib/components/RichComposer.svelte';
	import { submit, unsavedGuard } from '$lib/forms';
	import { fmtDate } from '$lib/fmt';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();

	const purpose = $derived(data.purpose);
	const base = $derived(`/org/${data.shell.org.slug}/purposes`);
	const statusIcons: Record<string, IconName> = { needs: 'alert', review: 'history', approved: 'check', changes: 'close' };

	let responsible = $state<Record<number, boolean>>({});
	let seeded = $state(0);
	// Seed the checkbox row from the loaded purpose, and re-seed when an
	// action reload hands back a fresh revision.
	$effect(() => {
		if (purpose.revision !== seeded) {
			responsible = Object.fromEntries(purpose.responsibles.map((member) => [member.id, true]));
			seeded = purpose.revision;
		}
	});
	const initials = (name: string) =>
		name
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('');
</script>

<svelte:head>
	<title>{purpose.name} · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="purposes">
	<PageHead title={purpose.name} back={{ href: base, label: 'Purposes' }}>
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

	{#if data.msg}
		<Notice tone="success">{data.msg}</Notice>
	{/if}

	<div class="purpose-grid">
		<div class="stack">
			{#if !purpose.ready}
				<Notice tone="warning">
					<strong>Needed before review</strong>
					{#if purpose.kind === 'expense'}evidence or Notes{:else}Notes{/if} recording what this purpose is for.
				</Notice>
			{/if}

			<section class="panel" aria-labelledby="allocations-heading">
				<div class="panel__head">
					<Icon name="ledger" size={16} />
					<h2 id="allocations-heading">Bank transactions</h2>
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

			<section class="panel" aria-labelledby="notes-heading">
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
						<form method="POST" action="?/notes" class="form" use:submit use:unsavedGuard>
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
						</form>
					{/if}
				</div>
			</section>

			<section class="panel" aria-labelledby="evidence-heading">
				<div class="panel__head">
					<Icon name="file" size={16} />
					<h2 id="evidence-heading">Evidence</h2>
					{#if purpose.evidence.length > 0}
						<span class="count">{purpose.evidence.length}</span>
					{/if}
				</div>
				{#if purpose.evidence.length > 0}
					<ul class="rows">
						{#each purpose.evidence as document (document.id)}
							<li>
								<div class="rows__main">
									<a href={document.url}><Icon name="file" size={14} />{document.filename}</a>
									<span class="rows__sub">{document.sizeDisplay}{document.note ? ` · ${document.note}` : ''}</span>
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<div class="panel__body"><p class="muted">No documents. Notes can record why evidence is unavailable.</p></div>
				{/if}
				{#if purpose.can.upload}
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
			</section>

			<section class="panel" aria-labelledby="responsible-heading">
				<div class="panel__head">
					<Icon name="people" size={16} />
					<h2 id="responsible-heading">Responsibility</h2>
					{#if purpose.responsibleInactive}
						<span class="badge badge--needs">Needs an active member</span>
					{/if}
				</div>
				<div class="panel__body stack">
					{#if purpose.responsibles.length > 0}
						<p>
							{#each purpose.responsibles as member (member.id)}
								{member.name}{member.active ? '' : ' (inactive)'}{member.id !== purpose.responsibles[purpose.responsibles.length - 1]?.id ? ', ' : ''}
							{/each}
						</p>
					{:else}
						<p class="muted">Nobody yet; allocations inherit the transaction's responsible member.</p>
					{/if}
					{#if purpose.can.assign}
						<form method="POST" action="?/responsibles" class="form" use:submit use:unsavedGuard>
							<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
							<input type="hidden" name="revision" value={purpose.revision} />
							<fieldset class="field">
								<legend>Responsible members <span class="req" aria-hidden="true">*</span></legend>
								{#each purpose.members as member (member.id)}
									<Label class="check" for={`responsible-${member.id}`}>
 <Checkbox id={`responsible-${member.id}`} name="responsible_id[]" value={String(member.id)} bind:checked={() => responsible[member.id] ?? false, checked => responsible[member.id] = checked} />
										{member.name}
									</Label>
								{/each}
							</fieldset>
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
						</form>
					{/if}
				</div>
			</section>

			{#if purpose.kind === 'expense'}
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
								<form method="POST" action="?/approve" class="form form--inline" use:submit>
									<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
									<input type="hidden" name="revision" value={purpose.revision} />
									<div class="field">
										<Label for="approve-note">Note</Label>
										<Input class="" id="approve-note" name="note" />
									</div>
									<Button class="" type="submit" variant="default"><Icon name="check" size={16} />Approve</Button>
								</form>
								<form method="POST" action="?/requestChanges" class="form form--inline" use:submit>
									<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
									<input type="hidden" name="revision" value={purpose.revision} />
									<div class="field">
										<Label for="changes-note">What changes <span class="req" aria-hidden="true">*</span></Label>
										<Input class="" id="changes-note" name="note" required />
									</div>
									<Button class="" type="submit" variant="outline"><Icon name="alert" size={16} />Request changes</Button>
								</form>
							{:else if purpose.approval.ineligibleReason}
								<p class="muted">{purpose.approval.ineligibleReason}</p>
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

			{#if purpose.audit.length > 0}
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
		</div>

		<aside class="discussion" aria-labelledby="discussion-heading">
			<div class="discussion__head">
				<Icon name="comment" size={16} />
				<h2 id="discussion-heading">Discussion</h2>
				<span class="count">{purpose.messages.length}</span>
			</div>
			<p class="discussion__context muted">About <strong>{purpose.name}</strong> · {purpose.kindLabel.toLowerCase()} purpose</p>
			{#if purpose.messages.length > 0}
				<ol class="chat">
					{#each purpose.messages as message (message.id)}
						<li class="chat__item" class:chat__item--mine={message.mine}>
							<span class="avatar avatar--sm" aria-hidden="true">
								{#if message.authorPicture}
									<img src={message.authorPicture} alt="" loading="lazy" data-loaded="true" />
								{:else}
									{initials(message.authorName)}
								{/if}
							</span>
							<div class="chat__body">
								<p class="chat__meta">
									<strong>{message.authorName}</strong>
									<span class="muted"> · {message.createdAt}</span>
								</p>
								<MarkdownView source={message.bodyMd} />
							</div>
						</li>
					{/each}
				</ol>
			{:else}
				<p class="muted discussion__empty">No messages yet.</p>
			{/if}
			{#if purpose.can.comment}
				<form method="POST" action="?/message" class="discussion__composer" use:submit={{ reset: true }}>
					<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
					<RichComposer
						id="discussion-message"
						name="body"
						label="Discussion message"
						rows={3}
						required
						placeholder="Message the team — @handle to mention"
						members={purpose.members}
					/>
					<div class="form-actions">
						<Button class="" type="submit" variant="outline"><Icon name="comment" size={16} />Send</Button>
					</div>
				</form>
			{/if}
		</aside>
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
</style>
