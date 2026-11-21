<script lang="ts">
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import Select from '#lib/components/ui/FormSelect.svelte';
	import DatePicker from '#lib/components/ui/DatePicker.svelte';
	import MoneyInput from '#lib/components/ui/MoneyInput.svelte';
	import TimeField from '#lib/components/ui/TimeField.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Notice from '#lib/components/Notice.svelte';
	import OrgShell from '#lib/components/OrgShell.svelte';
	import PageHead from '#lib/components/PageHead.svelte';
	import { submit, unsavedGuard } from '#lib/forms.ts';
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
							<Label for="new-pocket">Pocket</Label>
							<Select id="new-pocket" name="pocket_id" items={data.pockets.map((pocket) => ({ value: String(pocket.id), label: pocket.name }))} required />
						</div>
						<div class="field">
							<Label for="new-direction">Direction</Label>
							<Select id="new-direction" name="direction" items={[{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }]} value="out" required />
						</div>
						<div class="field">
							<Label for="new-amount">Amount (IDR) <span class="req" aria-hidden="true">*</span></Label>
							<MoneyInput id="new-amount" name="amount" required />
						</div>
						<div class="field">
							<Label for="new-date">Date</Label>
							<DatePicker id="new-date" name="date" value={data.today} required />
						</div>
						<div class="field">
							<Label for="new-time">Time</Label>
							<TimeField id="new-time" name="time" />
						</div>
						<div class="field">
							<Label for="new-counterparty">Counterparty <span class="req" aria-hidden="true">*</span></Label>
							<Input class="" id="new-counterparty" name="counterparty" required />
						</div>
						<div class="field">
							<Label for="new-type">Type</Label>
							<Input class="" id="new-type" name="transaction_type" placeholder="Bank transfer" />
						</div>
						<div class="field">
							<Label for="new-balance">Balance after</Label>
							<MoneyInput id="new-balance" name="balance" />
						</div>
						<div class="field">
							<Label for="new-responsible">Responsible</Label>
							<Select id="new-responsible" name="responsible_member_id" items={[{ value: '', label: 'Unassigned' }, ...data.members.map((member) => ({ value: String(member.id), label: member.name }))]} />
						</div>
					</div>
					<div class="field">
						<Label for="new-notes">Bank notes</Label>
						<Input class="" id="new-notes" name="notes" />
					</div>
					<div class="field">
						<Label for="new-explanation">Explanation</Label>
						<Textarea class="" id="new-explanation" name="explanation"></Textarea>
					</div>
					<div class="form-actions">
						<Button class="" type="submit" variant="default"><Icon name="check" size={16} />Record</Button>
					</div>
				</form>
			</div>
		</div>
	{/if}
</OrgShell>
