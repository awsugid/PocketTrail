<script lang="ts">
	import { enhance } from '$app/forms';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import SettingsNav from '$lib/components/SettingsNav.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const s = $derived(data.settings);
	const slug = $derived(data.shell.org.slug);
	const base = $derived(`/org/${slug}/settings/notifications`);
	const canManage = $derived(s.can.notifications);
	const preview = $derived(s.notificationPreview);
</script>

<svelte:head>
	<title>Notifications · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="settings">
	<div class="page-head">
		<div>
			<h1>Notifications</h1>
			<p class="lede">
				Off by default. When on, messages are captured in a local outbox only — this build sends no email and
				runs no scheduler. Enabling never releases messages queued while disabled.
			</p>
		</div>
	</div>

	<SettingsNav current="notifications" can={s.can} slug={slug} />

	{#if s.msg}<p class="notice" role="status">{s.msg}</p>{/if}

	{#if canManage}
		<section class="detail-section" aria-labelledby="preview-heading">
			<h2 id="preview-heading">Preview recipients</h2>
			<p class="section-lede">
				Choose the transaction-date cutoff and preview who would be asked for documentation. Enabling requires
				previewing the same cutoff first.
			</p>
			<form method="GET" action={base} class="inline-form">
				<label for="cutoff">Transaction-date cutoff</label>
				<input class="input" id="cutoff" name="cutoff_date" type="date" value={s.notificationPreviewCutoff} required />
				<button class="btn" type="submit">Preview recipients</button>
			</form>

			{#if preview}
				<div class="preview" role="status">
					<p>
						{preview.recipients.length} recipient{preview.recipients.length === 1 ? '' : 's'} at cutoff
						<strong>{s.notificationPreviewCutoff}</strong>: {preview.totalItems} documentation
						item{preview.totalItems === 1 ? '' : 's'} pending.
						{#if preview.limited}<span class="muted">Scan limited to the most recent 500 movements.</span>{/if}
					</p>
					{#if preview.recipients.length > 0}
						<ul class="plain-list">
							{#each preview.recipients as recipient (recipient.name)}
								<li>{recipient.name}: {recipient.pending} pending</li>
							{/each}
						</ul>
					{:else}
						<p class="muted">Nobody has documentation pending at this cutoff.</p>
					{/if}
				</div>
			{/if}
		</section>

		<section class="detail-section" aria-labelledby="settings-heading">
			<h2 id="settings-heading">Delivery settings</h2>
			<form method="POST" action="?/saveNotifications" use:enhance class="stack-form">
				<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
				<input type="hidden" name="preview_token" value={s.previewToken} />
				<label class="check">
					<input type="checkbox" name="enabled" checked={s.notifications.enabled} /> Enable organization
					notifications
				</label>
				<div class="field">
					<label for="cutoff-save">Transaction-date cutoff</label>
					<input class="input" id="cutoff-save" name="cutoff_date" type="date" value={s.notifications.cutoffDate ?? ''} />
					<p class="hint">A preview for a different cutoff is rejected. Mentions are not limited by this cutoff.</p>
				</div>
				<button class="btn btn--primary" type="submit">Save notification settings</button>
			</form>

			<form method="POST" action="/org/{slug}/notifications/digest" class="stack-form compact">
				<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
				<button class="btn" type="submit" disabled={!s.notifications.enabled}>Capture weekly digests now</button>
				<p class="hint">Captures one digest per eligible recipient whose cadence allows it. No email is sent.</p>
			</form>
		</section>

		<section class="detail-section" aria-labelledby="outbox-heading">
			<h2 id="outbox-heading">Local outbox</h2>
			{#if !s.notifications.enabled}
				<p class="muted">Notifications are disabled; nothing is deliverable.</p>
			{:else if s.outbox.length === 0}
				<p class="muted">No deliverable messages are queued.</p>
			{:else}
				<div class="table-scroll">
					<table class="ledger">
						<caption class="visually-hidden">Queued notifications, newest first</caption>
						<thead>
							<tr>
								<th scope="col">Kind</th>
								<th scope="col">To</th>
								<th scope="col">Subject</th>
								<th scope="col">Queued</th>
							</tr>
						</thead>
						<tbody>
							{#each s.outbox as row, index (index)}
								<tr>
									<td data-label="Kind">{row.kind}</td>
									<td data-label="To">{row.toName}</td>
									<td data-label="Subject">{row.subject}</td>
									<td class="cell--nowrap" data-label="Queued">{row.createdAtLabel}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			<p class="hint">
				Reading the outbox re-checks eligibility now: removed members, disabled organizations, suppressed
				transactions and completed income are filtered out of this list.
			</p>
		</section>
	{:else}
		<p class="muted">Notification settings require the manage-notifications permission.</p>
	{/if}
</OrgShell>

<style>
	.section-lede { margin: 0 0 12px; max-width: 70ch; color: var(--text-secondary); }
	.inline-form { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; font-size: 13px; color: var(--text-secondary); }
	.stack-form { display: flex; flex-direction: column; gap: 12px; margin-top: 8px; max-width: 560px; }
	.stack-form.compact { gap: 6px; }
	.check { display: flex; align-items: center; gap: 8px; font-size: 14px; }
	.field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--text-secondary); }
	.hint { margin: 0; font-size: 12px; color: var(--text-secondary); }
	.preview { margin: 12px 0; padding: 10px 12px; background: var(--surface-2); border-radius: var(--radius-control); max-width: 640px; }
	.preview p { margin: 0 0 6px; }
</style>
