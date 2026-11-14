<script lang="ts">
	import Empty from '$lib/components/Empty.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import { submit } from '$lib/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const slug = $derived(data.shell.org.slug);
</script>

<svelte:head>
	<title>Inventory · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="inventory">
	<PageHead title="Inventory" icon="inventory" />

	{#if data.message}<Notice tone="success">{data.message}</Notice>{/if}

	<div class="stack">
		<section class="panel" aria-labelledby="items-heading">
			<div class="panel__head">
				<Icon name="inventory" size={16} /><h2 id="items-heading">Items</h2>
				<span class="count">{data.items.length}</span>
			</div>
			{#if data.items.length === 0}
				<Empty icon="inventory" title="No items yet" inline />
			{:else}
				<div class="table-scroll">
					<table class="ledger">
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
											<span class="muted">—</span>
										{:else}
											<ul class="holdings">
												{#each item.levels as level (level.locationId)}
													<li>{level.locationName} <strong>{level.qty}</strong></li>
												{/each}
											</ul>
										{/if}
									</td>
									<td class="cell--num"><strong>{item.totalQty}</strong></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		{#if data.can.updateStock}
			<div class="two-up">
				<section class="panel" aria-labelledby="stock-heading">
					<div class="panel__head"><Icon name="history" size={16} /><h2 id="stock-heading">Stock change</h2></div>
					<div class="panel__body">
						<form method="POST" action="?/updateStock" class="form" use:submit={{ reset: true }}>
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
							<div class="form-grid">
								<div class="field">
									<label for="stock-direction">Direction</label>
									<select class="select" id="stock-direction" name="direction">
										<option value="add">Add</option>
										<option value="remove">Remove</option>
									</select>
								</div>
								<div class="field">
									<label for="stock-quantity">Quantity</label>
									<input class="input" id="stock-quantity" name="quantity" type="number" min="1" step="1" required />
								</div>
							</div>
							<div class="field">
								<label for="stock-reason">Reason <span class="req" aria-hidden="true">*</span></label>
								<input class="input" id="stock-reason" name="reason" required />
							</div>
							<div class="form-actions">
								<button class="btn btn--primary" type="submit"><Icon name="check" size={16} />Record</button>
							</div>
						</form>
					</div>
				</section>

				<div class="stack">
					<section class="panel" aria-labelledby="item-heading">
						<div class="panel__head"><Icon name="plus" size={16} /><h2 id="item-heading">New item</h2></div>
						<div class="panel__body">
							<form method="POST" action="?/addItem" class="form" use:submit={{ reset: true }}>
								<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
								<div class="form-grid">
									<div class="field">
										<label for="item-name">Name <span class="req" aria-hidden="true">*</span></label>
										<input class="input" id="item-name" name="name" required />
									</div>
									<div class="field">
										<label for="item-variant">Variant</label>
										<input class="input" id="item-variant" name="variant" placeholder="Size M" />
									</div>
								</div>
								<div class="form-actions">
									<button class="btn" type="submit"><Icon name="plus" size={16} />Add item</button>
								</div>
							</form>
						</div>
					</section>

					<section class="panel" aria-labelledby="location-heading">
						<div class="panel__head"><Icon name="org" size={16} /><h2 id="location-heading">New location</h2></div>
						<div class="panel__body">
							<form method="POST" action="?/addLocation" class="form" use:submit={{ reset: true }}>
								<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
								<div class="field">
									<label for="location-name">Name <span class="req" aria-hidden="true">*</span></label>
									<input class="input" id="location-name" name="name" required placeholder="Storage or holder" />
								</div>
								<div class="form-actions">
									<button class="btn" type="submit"><Icon name="plus" size={16} />Add location</button>
								</div>
							</form>
						</div>
					</section>
				</div>
			</div>
		{/if}
	</div>
</OrgShell>
