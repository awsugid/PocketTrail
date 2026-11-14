<script lang="ts">
	import Empty from '$lib/components/Empty.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import SettingsNav from '$lib/components/SettingsNav.svelte';
	import { guard, submit } from '$lib/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const s = $derived(data.settings);
	const slug = $derived(data.shell.org.slug);
	const base = $derived(`/org/${slug}/settings/notifications`);
	const preview = $derived(s.notificationPreview);
</script>

<svelte:head>
	<title>Notifications · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="settings">
	<PageHead title="Notifications" icon="bell">
		{#snippet meta()}
			<span class="badge badge--{s.notifications.enabled ? 'approved' : 'muted'}">{s.notifications.enabled ? 'On' : 'Off'}</span>
			<span>Local outbox only · no email is sent</span>
		{/snippet}
	</PageHead>
	<SettingsNav current="notifications" can={s.can} slug={slug} />

	{#if s.msg}<Notice tone="success">{s.msg}</Notice>{/if}

	{#if !s.can.notifications}
		<Notice tone="warning">Notification settings need the manage-notifications permission.</Notice>
	{:else}
		<div class="stack">
			<section class="panel" aria-labelledby="preview-heading">
				<div class="panel__head"><Icon name="people" size={16} /><h2 id="preview-heading">Preview recipients</h2></div>
				<div class="panel__body stack">
					<form method="GET" action={base} class="form form--inline">
						<div class="field">
							<label for="cutoff">Transaction-date cutoff</label>
							<input class="input" id="cutoff" name="cutoff_date" type="date" value={s.notificationPreviewCutoff} required />
						</div>
						<button class="btn" type="submit"><Icon name="filter" size={16} />Preview</button>
					</form>

					{#if preview}
						<div role="status">
							<p>
								<strong>{preview.totalItems}</strong> item{preview.totalItems === 1 ? '' : 's'} pending for
								<strong>{preview.recipients.length}</strong> recipient{preview.recipients.length === 1 ? '' : 's'} since
								{s.notificationPreviewCutoff}.
								{#if preview.limited}<span class="muted">Latest 500 movements only.</span>{/if}
							</p>
							{#if preview.recipients.length > 0}
								<ul class="rows">
									{#each preview.recipients as recipient (recipient.name)}
										<li>
											<div class="rows__main"><strong>{recipient.name}</strong></div>
											<span class="badge badge--needs">{recipient.pending} pending</span>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					{/if}
				</div>
			</section>

			<section class="panel" aria-labelledby="settings-heading">
				<div class="panel__head"><Icon name="settings" size={16} /><h2 id="settings-heading">Delivery</h2></div>
				<div class="panel__body stack">
					<form method="POST" action="?/saveNotifications" class="form" use:submit>
						<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
						<input type="hidden" name="preview_token" value={s.previewToken} />
						<label class="check">
							<input type="checkbox" name="enabled" checked={s.notifications.enabled} />Enable notifications for this organization
						</label>
						<div class="field">
							<label for="cutoff-save">Transaction-date cutoff</label>
							<input class="input" id="cutoff-save" name="cutoff_date" type="date" value={s.notifications.cutoffDate ?? ''} />
							<p class="hint">Preview this cutoff first. Mentions ignore the cutoff.</p>
						</div>
						<div class="form-actions">
							<button class="btn btn--primary" type="submit"><Icon name="check" size={16} />Save</button>
						</div>
					</form>
					<form method="POST" action="/org/{slug}/notifications/digest" use:guard>
						<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
						<button class="btn" type="submit" disabled={!s.notifications.enabled}>
							<Icon name="mail" size={16} />Capture weekly digests
						</button>
					</form>
				</div>
			</section>

			<section class="panel" aria-labelledby="outbox-heading">
				<div class="panel__head">
					<Icon name="inbox" size={16} /><h2 id="outbox-heading">Outbox</h2>
					<span class="count">{s.outbox.length}</span>
				</div>
				{#if !s.notifications.enabled}
					<Empty icon="bell" title="Notifications are off" inline />
				{:else if s.outbox.length === 0}
					<Empty icon="inbox" title="Nothing queued" inline />
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
										<td>{row.kind}</td>
										<td>{row.toName}</td>
										<td>{row.subject}</td>
										<td class="cell--nowrap">{row.createdAtLabel}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</section>
		</div>
	{/if}
</OrgShell>
