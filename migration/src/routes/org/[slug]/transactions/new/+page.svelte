<script lang="ts">
	import OrgShell from '$lib/components/OrgShell.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const slug = $derived(data.shell.org.slug);
	const today = new Date().toISOString().slice(0, 10);
</script>

<svelte:head>
	<title>Record a movement · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="transactions">
	<p class="back"><a href="/org/{slug}/transactions">← Ledger</a></p>

	<div class="page-head">
		<div>
			<h1>Record a movement</h1>
			<p class="lede">
				Manual entries are for money that never appeared in an imported statement. Recorded entries have no Jago
				transaction ID, so a later import cannot match them.
			</p>
		</div>
	</div>

	{#if data.msg}<p class="notice" role="status">{data.msg}</p>{/if}

	{#if !data.canRecord}
		<p class="notice notice--danger">
			Your role does not include documenting transactions, so you cannot record a movement. Ask a member who can.
		</p>
	{:else if data.pockets.length === 0}
		<p class="notice notice--danger">
			This organization has no pocket yet. Create a pocket in Settings before recording a movement.
		</p>
	{:else}
		<form method="POST" action="/org/{slug}/transactions/new" class="stack-form">
			<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
			<div class="form-grid">
				<div class="field">
					<label for="new-pocket">Pocket</label>
					<select class="select" id="new-pocket" name="pocket_id" required>
						{#each data.pockets as pocket (pocket.id)}
							<option value={pocket.id}>{pocket.name}</option>
						{/each}
					</select>
				</div>
				<div class="field">
					<label for="new-date">Date</label>
					<input class="input" id="new-date" name="date" type="date" value={today} required />
				</div>
				<div class="field">
					<label for="new-time">Time <span class="muted">(optional)</span></label>
					<input class="input" id="new-time" name="time" type="time" />
				</div>
				<div class="field">
					<label for="new-counterparty">Counterparty</label>
					<input class="input" id="new-counterparty" name="counterparty" required />
				</div>
				<div class="field">
					<label for="new-type">Transaction type</label>
					<input class="input" id="new-type" name="transaction_type" placeholder="e.g. Bank Transfer" />
				</div>
				<div class="field">
					<label for="new-amount">Amount (IDR)</label>
					<input class="input" id="new-amount" name="amount" inputmode="decimal" required aria-describedby="new-amount-hint" />
					<p class="hint" id="new-amount-hint">A positive rupiah value such as 150000; minor units stay internal.</p>
				</div>
				<div class="field">
					<label for="new-direction">Direction</label>
					<select class="select" id="new-direction" name="direction" required>
						<option value="out">Money out (expense)</option>
						<option value="in">Money in (income)</option>
					</select>
				</div>
				<div class="field">
					<label for="new-balance">Balance after <span class="muted">(optional)</span></label>
					<input class="input" id="new-balance" name="balance" inputmode="decimal" />
				</div>
				<div class="field">
					<label for="new-responsible">Responsible member <span class="muted">(optional)</span></label>
					<select class="select" id="new-responsible" name="responsible_member_id">
						<option value="">Unassigned</option>
						{#each data.members as member (member.id)}
							<option value={member.id}>{member.name}</option>
						{/each}
					</select>
				</div>
			</div>
			<div class="field">
				<label for="new-notes">Bank notes <span class="muted">(optional)</span></label>
				<input class="input" id="new-notes" name="notes" />
			</div>
			<div class="field">
				<label for="new-explanation">Explanation <span class="muted">(optional now, required before review)</span></label>
				<textarea class="input textarea" id="new-explanation" name="explanation"></textarea>
			</div>
			<button class="btn btn--primary" type="submit">Record movement</button>
		</form>
	{/if}
</OrgShell>

<style>
	.back {
		margin: 0 0 8px;
	}
	.stack-form {
		display: flex;
		flex-direction: column;
		gap: 14px;
		max-width: 720px;
		margin-top: 16px;
	}
	.form-grid {
		display: grid;
		gap: 14px;
	}
	@media (min-width: 720px) {
		.form-grid {
			grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		}
	}
	.textarea {
		width: 100%;
		min-height: 84px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.hint {
		margin: 4px 0 0;
		font-size: 12px;
		color: var(--text-secondary);
	}
</style>
