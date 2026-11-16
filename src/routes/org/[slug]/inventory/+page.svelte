<script lang="ts">
	import Select from '$lib/components/ui/Select.svelte';
	import Empty from '$lib/components/Empty.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import { submit } from '$lib/forms';
	import { stack } from '$lib/table';
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

	<nav class="chips" aria-label="Inventory status">
		<a class="chip" href="/org/{slug}/inventory" aria-current={!data.showArchived ? 'true' : undefined}>Active</a>
		<a class="chip" href="/org/{slug}/inventory?archived=1" aria-current={data.showArchived ? 'true' : undefined}>Archived</a>
	</nav>

	<div class="stack">
		<section class="panel" aria-labelledby="items-heading">
			<div class="panel__head">
				<Icon name="inventory" size={16} /><h2 id="items-heading">Items</h2>
				<span class="count">{data.items.length}</span>
			</div>
			{#if data.items.length === 0}
				<Empty icon="inventory" title={data.showArchived ? 'No archived items' : 'No items yet'} inline />
			{:else}
				<div class="table-scroll">
					<table class="ledger stack" use:stack>
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
										{#if item.archived}<span class="badge badge--muted">Archived</span>{/if}
									</td>
									<td data-label="Holdings">
										{#if item.levels.length === 0}
											<span class="muted">—</span>
										{:else}
											<ul class="holdings">
												{#each item.levels as level (level.locationId)}
													<li><strong>{level.qty}</strong> · {level.locationName}</li>
												{/each}
											</ul>
										{/if}
									</td>
									<td class="cell--num" data-label="Total"><strong>{item.totalQty}</strong></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<section class="panel" aria-labelledby="locations-heading">
			<div class="panel__head"><Icon name="org" size={16} /><h2 id="locations-heading">Locations</h2><span class="count">{data.managedLocations.length}</span></div>
			{#if data.managedLocations.length === 0}
				<Empty icon="org" title={data.showArchived ? 'No archived locations' : 'No locations yet'} inline />
			{:else}
				<ul class="rows">
					{#each data.managedLocations as location (location.id)}
						<li>
							<div class="rows__main">
								<strong>{location.name}</strong>
								{#if location.archived_at !== null}<span class="badge badge--muted">Archived</span>{/if}
								{#if data.can.updateStock && location.archived_at === null}
									<details>
										<summary>Edit location<span class="visually-hidden"> {location.name}</span></summary>
										<form method="POST" action="?/saveLocation" class="form" use:submit>
											<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
											<input type="hidden" name="id" value={location.id} />
											<div class="field">
												<label for="location-name-{location.id}">Name</label>
												<input class="input" id="location-name-{location.id}" name="name" value={location.name} maxlength="100" required />
											</div>
											<div class="form-actions"><button class="btn" type="submit"><Icon name="check" size={14} />Save location</button></div>
										</form>
									</details>
								{/if}
							</div>
							{#if data.can.updateStock}
								{#if location.archived_at !== null}
									<form method="POST" action="?/restoreLocation" use:submit>
										<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
										<input type="hidden" name="id" value={location.id} />
										<button class="btn btn--sm" type="submit">Restore<span class="visually-hidden"> {location.name}</span></button>
									</form>
								{:else}
									<form method="POST" action="?/archiveLocation" use:submit={{ confirm: `Archive ${location.name}? Stock must be zero. History is retained.`, confirmLabel: 'Archive' }}>
										<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
										<input type="hidden" name="id" value={location.id} />
										<button class="btn btn--sm btn--danger" type="submit">Archive<span class="visually-hidden"> {location.name}</span></button>
									</form>
								{/if}
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		{#if data.can.updateStock && !data.showArchived}
			<div class="two-up">
				<section class="panel" aria-labelledby="stock-heading">
					<div class="panel__head"><Icon name="history" size={16} /><h2 id="stock-heading">Stock change</h2></div>
					<div class="panel__body">
						<form method="POST" action="?/updateStock" class="form" use:submit={{ reset: true }}>
							<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
							<div class="field">
								<label for="stock-item">Item</label>
								<Select id="stock-item" name="item_id" items={data.stockItems.map((item) => ({ value: String(item.id), label: item.name + (item.variant ? ` — ${item.variant}` : '') }))} required />
							</div>
							<div class="field">
								<label for="stock-location">Location</label>
								<Select id="stock-location" name="location_id" items={data.locations.map((location) => ({ value: String(location.id), label: location.name }))} required />
							</div>
							<div class="form-grid">
								<div class="field">
									<label for="stock-direction">Direction</label>
									<Select id="stock-direction" name="direction" items={[{ value: 'add', label: 'Add' }, { value: 'remove', label: 'Remove' }]} value="add" required />
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
										<input class="input" id="item-name" name="name" maxlength="100" required />
									</div>
									<div class="field">
										<label for="item-variant">Variant</label>
										<input class="input" id="item-variant" name="variant" maxlength="100" placeholder="Size M" />
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
									<input class="input" id="location-name" name="name" maxlength="100" required placeholder="Storage or holder" />
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
