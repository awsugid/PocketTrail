<script lang="ts">
	import OrgShell from '$lib/components/OrgShell.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const slug = $derived(data.shell.org.slug);
</script>

<OrgShell {...data.shell} active="inventory">
	{#if data.message}
		<p class="notice" role="status">{data.message}</p>
	{/if}

	<div class="page-head">
		<div>
			<h1>Inventory</h1>
			<p class="lede">Merchandise on hand, by item and location. Every change records who moved it and why.</p>
		</div>
	</div>

	{#if data.items.length === 0}
		<div class="empty-state">
			{#if data.can.updateStock}
				<p>No merchandise is tracked yet.</p>
				<p class="muted">Add your first item below to start tracking quantities per location.</p>
			{:else}
				<p>No merchandise is tracked for this organization yet.</p>
				<p class="muted">Members who can update stock can add the first item.</p>
			{/if}
		</div>
	{:else}
		<div class="table-scroll">
			<table class="inventory">
				<caption class="visually-hidden">Items with quantities per location</caption>
				<thead>
					<tr>
						<th scope="col">Item</th>
						<th scope="col">Holdings</th>
						<th scope="col" class="cell--num">Total</th>
					</tr>
				</thead>
				<tbody>
					{#each data.items as item (item.id)}
						<tr>
							<td class="row-identity">
								<a href="/org/{slug}/inventory/{item.id}">{item.name}</a>
								{#if item.variant}<span class="cell__sub">{item.variant}</span>{/if}
							</td>
							<td>
								{#if item.levels.length === 0}
									<span class="muted">Nothing recorded</span>
								{:else}
									<ul class="holding-list">
										{#each item.levels as level (level.locationId)}
											<li>{level.locationName}: <strong>{level.qty}</strong></li>
										{/each}
									</ul>
								{/if}
							</td>
							<td class="cell--num">{item.totalQty}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if data.can.updateStock}
		<div class="inventory-forms">
			<section class="inventory-form">
				<h2>Record a stock change</h2>
				<form method="POST" action="?/updateStock">
					<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
					<div class="field">
						<label for="stock-item">Item</label>
						<select class="select" id="stock-item" name="item_id" required>
							{#each data.items as item (item.id)}
								<option value={item.id}>{item.name}{item.variant ? ` — ${item.variant}` : ''}</option>
							{/each}
						</select>
					</div>
					<div class="field">
						<label for="stock-location">Location</label>
						<select class="select" id="stock-location" name="location_id" required>
							{#each data.locations as location (location.id)}
								<option value={location.id}>{location.name}</option>
							{/each}
						</select>
					</div>
					<div class="field">
						<label for="stock-direction">Direction</label>
						<select class="select" id="stock-direction" name="direction">
							<option value="add">Add stock</option>
							<option value="remove">Remove stock</option>
						</select>
					</div>
					<div class="field">
						<label for="stock-quantity">Quantity</label>
						<input class="input" id="stock-quantity" name="quantity" type="number" min="1" step="1" required />
					</div>
					<div class="field">
						<label for="stock-reason">Reason</label>
						<input class="input" id="stock-reason" name="reason" required />
						<p class="hint">Recorded with your name and the time on the item's history.</p>
					</div>
					<button class="btn btn--primary" type="submit">Record change</button>
				</form>
			</section>

			<section class="inventory-form">
				<h2>Add an item</h2>
				<form method="POST" action="?/addItem">
					<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
					<div class="field">
						<label for="item-name">Name</label>
						<input class="input" id="item-name" name="name" required />
					</div>
					<div class="field">
						<label for="item-variant">Variant <span class="muted">(optional, e.g. shirt size)</span></label>
						<input class="input" id="item-variant" name="variant" />
					</div>
					<button class="btn" type="submit">Add item</button>
				</form>

				<h2>Add a location</h2>
				<form method="POST" action="?/addLocation">
					<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
					<div class="field">
						<label for="location-name">Name</label>
						<input class="input" id="location-name" name="name" required />
						<p class="hint">A storage place, or an organizer holding stock.</p>
					</div>
					<button class="btn" type="submit">Add location</button>
				</form>
			</section>
		</div>
	{/if}
</OrgShell>

<style>
	.holding-list {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.holding-list strong {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	.inventory-forms {
		display: grid;
		gap: 24px;
		margin-top: 28px;
	}
	@media (min-width: 960px) {
		.inventory-forms {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
	}
	.inventory-form {
		max-width: 640px;
	}
	.inventory-form h2 {
		font-size: 18px;
		margin: 0 0 12px;
	}
	.inventory-form form + h2 {
		margin-top: 20px;
	}
	.hint {
		margin: 4px 0 0;
		font-size: 12px;
		color: var(--text-secondary);
	}
</style>
