<script lang="ts">
	import Select from '$lib/components/ui/Select.svelte';
	import Empty from '$lib/components/Empty.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import { submit } from '$lib/forms';
	import { stack } from '$lib/table';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{data.item.name} · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="inventory">
	<PageHead
		title={data.item.name + (data.item.variant ? ` — ${data.item.variant}` : '')}
		icon="inventory"
		back={{ href: `/org/${data.shell.org.slug}/inventory`, label: 'Inventory' }}
	/>

	<div class="stack">
		<div class="detail-grid">
			<section class="panel" aria-labelledby="stock-now-heading">
				<div class="panel__head">
					<Icon name="inventory" size={16} /><h2 id="stock-now-heading">In stock</h2>
					<span class="count"><strong>{data.totalQty}</strong> total</span>
				</div>
				{#if data.levels.length === 0}
					<Empty icon="inventory" title="None in stock" inline />
				{:else}
					<dl class="panel__body facts">
						{#each data.levels as level (level.locationName)}
							<dt>{level.locationName}</dt>
							<dd><strong>{level.qty}</strong></dd>
						{/each}
					</dl>
				{/if}
			</section>

			{#if data.can.updateStock}
				<section class="panel" aria-labelledby="stock-change-heading">
					<div class="panel__head"><Icon name="history" size={16} /><h2 id="stock-change-heading">Stock change</h2></div>
					<div class="panel__body">
						<form method="POST" action="?/updateStock" class="form" use:submit={{ reset: true }}>
							<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
							<input type="hidden" name="item_id" value={data.item.id} />
							<div class="form-grid">
								<div class="field field--wide">
									<label for="stock-location">Location</label>
									<Select id="stock-location" name="location_id" items={data.locations.map((location) => ({ value: String(location.id), label: location.name }))} required />
								</div>
								<div class="field">
									<label for="stock-direction">Direction</label>
									<Select id="stock-direction" name="direction" items={[{ value: 'add', label: 'Add' }, { value: 'remove', label: 'Remove' }]} />
								</div>
								<div class="field">
									<label for="stock-quantity">Quantity</label>
									<input class="input" id="stock-quantity" name="quantity" type="number" min="1" step="1" required />
								</div>
								<div class="field field--wide">
									<label for="stock-reason">Reason <span class="req" aria-hidden="true">*</span></label>
									<input class="input" id="stock-reason" name="reason" required />
								</div>
							</div>
							<div class="form-actions">
								<button class="btn btn--primary" type="submit"><Icon name="check" size={16} />Record</button>
							</div>
						</form>
					</div>
				</section>
			{/if}
		</div>

		<section class="panel" aria-labelledby="history-heading">
			<div class="panel__head"><Icon name="history" size={16} /><h2 id="history-heading">History</h2></div>
		{#if data.movements.length === 0}
			<Empty icon="history" title="No stock changes yet" inline />
		{:else}
			<div class="table-scroll">
				<table class="ledger stack" use:stack>
					<caption class="visually-hidden">Stock movement history with who, what, when, and why</caption>
					<thead>
						<tr>
							<th scope="col">When</th>
							<th scope="col">Who</th>
							<th scope="col">Location</th>
							<th scope="col" class="cell--num">Change</th>
							<th scope="col" class="cell--num">Result</th>
							<th scope="col">Reason</th>
						</tr>
					</thead>
					<tbody>
						{#each data.movements as movement (movement.at + movement.locationName)}
							<tr>
								<td class="cell--nowrap" data-label="When">{movement.at}</td>
								<td data-label="Who">{movement.memberName}</td>
								<td data-label="Location">{movement.locationName}</td>
								<td class="cell--num" data-label="Change" class:amount--in={movement.delta > 0}>{movement.delta > 0 ? `+${movement.delta}` : movement.delta}</td>
								<td class="cell--num" data-label="Result">{movement.resultQty}</td>
								<td data-label="Reason">{movement.reason}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
		</section>
	</div>
</OrgShell>
