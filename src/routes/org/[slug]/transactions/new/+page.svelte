<script lang="ts">
	import Select from '$lib/components/ui/Select.svelte';
	import DatePicker from '$lib/components/ui/DatePicker.svelte';
	import MoneyInput from '$lib/components/ui/MoneyInput.svelte';
	import TimeField from '$lib/components/ui/TimeField.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import { submit, unsavedGuard } from '$lib/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const slug = $derived(data.shell.org.slug);
</script>

<svelte:head>
	<title>Record a movement · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="transactions">
	<PageHead title="Record a movement" icon="plus" back={{ href: `/org/${slug}/transactions`, label: 'Ledger' }} />

	{#if data.msg}<Notice tone="success">{data.msg}</Notice>{/if}

	{#if !data.canRecord}
		<Notice tone="danger">Your role cannot document transactions.</Notice>
	{:else if data.pockets.length === 0}
		<Notice tone="warning">
			Create a pocket in <a href="/org/{slug}/settings/pockets">Settings</a> first.
		</Notice>
	{:else}
		<div class="panel">
			<div class="panel__body">
				<form method="POST" action="/org/{slug}/transactions/new" class="form" use:submit={{ reset: true }} use:unsavedGuard>
					<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
					<div class="form-grid">
						<div class="field">
							<label for="new-pocket">Pocket</label>
							<Select id="new-pocket" name="pocket_id" items={data.pockets.map((pocket) => ({ value: String(pocket.id), label: pocket.name }))} required />
						</div>
						<div class="field">
							<label for="new-direction">Direction</label>
							<Select id="new-direction" name="direction" items={[{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }]} value="out" required />
						</div>
						<div class="field">
							<label for="new-amount">Amount (IDR) <span class="req" aria-hidden="true">*</span></label>
							<MoneyInput id="new-amount" name="amount" required />
						</div>
						<div class="field">
							<label for="new-date">Date</label>
							<DatePicker id="new-date" name="date" value={data.today} required />
						</div>
						<div class="field">
							<label for="new-time">Time</label>
							<TimeField id="new-time" name="time" />
						</div>
						<div class="field">
							<label for="new-counterparty">Counterparty <span class="req" aria-hidden="true">*</span></label>
							<input class="input" id="new-counterparty" name="counterparty" required />
						</div>
						<div class="field">
							<label for="new-type">Type</label>
							<input class="input" id="new-type" name="transaction_type" placeholder="Bank transfer" />
						</div>
						<div class="field">
							<label for="new-balance">Balance after</label>
							<MoneyInput id="new-balance" name="balance" />
						</div>
						<div class="field">
							<label for="new-responsible">Responsible</label>
							<Select id="new-responsible" name="responsible_member_id" items={[{ value: '', label: 'Unassigned' }, ...data.members.map((member) => ({ value: String(member.id), label: member.name }))]} />
						</div>
					</div>
					<div class="field">
						<label for="new-notes">Bank notes</label>
						<input class="input" id="new-notes" name="notes" />
					</div>
					<div class="field">
						<label for="new-explanation">Explanation</label>
						<textarea class="input textarea" id="new-explanation" name="explanation"></textarea>
					</div>
					<div class="form-actions">
						<button class="btn btn--primary" type="submit"><Icon name="check" size={16} />Record</button>
					</div>
				</form>
			</div>
		</div>
	{/if}
</OrgShell>
