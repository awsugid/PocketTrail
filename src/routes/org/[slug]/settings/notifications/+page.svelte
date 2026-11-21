<script lang="ts">
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import Checkbox from '#lib/components/ui/LabeledCheckbox.svelte';
	import DatePicker from '#lib/components/ui/DatePicker.svelte';
	import Empty from '#lib/components/Empty.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Notice from '#lib/components/Notice.svelte';
	import OrgShell from '#lib/components/OrgShell.svelte';
	import PageHead from '#lib/components/PageHead.svelte';
	import SettingsNav from '#lib/components/SettingsNav.svelte';
	import { fmtDate } from '#lib/fmt.ts';
	import { guard, submit } from '#lib/forms.ts';
	import { stack } from '#lib/table.ts';
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
			<span>{data.emailDeliveryEnabled ? 'Notices are emailed to recipients' : 'Email delivery is disabled · notices stay in the outbox'}</span>
		{/snippet}
	</PageHead>
	<SettingsNav current="notifications" can={s.can} slug={slug} />

	{#if s.msg}<Notice tone="success">{s.msg}</Notice>{/if}

	{#if !s.can.notifications}
		<Notice tone="warning">Notification settings need the manage-notifications permission.</Notice>
	{:else}
		<div class="stack">
			<section class="panel" aria-labelledby="settings-heading">
				<div class="panel__head"><Icon name="settings" size={16} /><h2 id="settings-heading">Delivery</h2></div>
				<div class="panel__body stack">
					<form method="POST" action="?/saveNotifications" class="form" use:submit>
						<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
						<input type="hidden" name="preview_token" value={s.previewToken} />
						<Checkbox name="enabled" checked={s.notifications.enabled}>Enable notifications for this organization</Checkbox>
						<div class="field">
							<Label for="cutoff">Transaction-date cutoff</Label>
							<DatePicker id="cutoff" name="cutoff_date" value={s.notificationPreviewCutoff} clearable />
						</div>
						<div class="form-actions">
							<Button class="" type="submit" formaction="?/preview" variant="outline"><Icon name="filter" size={16} />Preview</Button>
							<Button class="" type="submit" variant="default"><Icon name="check" size={16} />Save</Button>
						</div>
					</form>

					{#if preview}
						<div role="status">
							<p>
								<strong>{preview.totalItems}</strong> item{preview.totalItems === 1 ? '' : 's'} pending for
								<strong>{preview.recipients.length}</strong> recipient{preview.recipients.length === 1 ? '' : 's'} since
								{fmtDate(s.notificationPreviewCutoff)}.
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

					<form method="POST" action="/org/{slug}/notifications/digest" class="form form--inline" use:guard>
						<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
						<Button class="" type="submit" disabled={!s.notifications.enabled} aria-describedby="digest-why" variant="outline">
							<Icon name="mail" size={16} />Send weekly digests
						</Button>
						{#if !s.notifications.enabled}<span class="hint" id="digest-why">Turn notifications on first.</span>{/if}
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
						<table class="ledger stack" use:stack>
							<caption class="visually-hidden">Queued notifications, newest first</caption>
							<thead>
								<tr>
									<th scope="col">Kind</th>
									<th scope="col">To</th>
									<th scope="col">Subject</th>
									<th scope="col">Queued</th>
									<th scope="col">Email</th>
								</tr>
							</thead>
							<tbody>
								{#each s.outbox as row, index (index)}
									<tr>
										<td data-label="Kind">{row.kind}</td>
										<td data-label="To">{row.toName}</td>
										<td data-label="Subject">{row.subject}</td>
										<td class="cell--nowrap" data-label="Queued">{row.createdAtLabel}</td>
										<td data-label="Email">{data.emailDeliveryEnabled || row.deliveryLabel !== 'Queued' ? row.deliveryLabel : 'Not sent (email disabled)'}</td>
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
