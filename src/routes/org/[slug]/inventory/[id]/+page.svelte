<script lang="ts">
	import OrgShell from '$lib/components/OrgShell.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<OrgShell {...data.shell} active="inventory">
	<p style="margin: 0 0 16px"><a href="/org/{data.shell.org.slug}/inventory">← Inventory</a></p>

	<div class="page-head">
		<div>
			<h1>{data.item.name}{data.item.variant ? ` — ${data.item.variant}` : ''}</h1>
			<p class="lede">Every recorded change to this item, newest first.</p>
		</div>
	</div>

	{#if data.movements.length === 0}
		<div class="empty-state">
			<p>No stock changes have been recorded for this item yet.</p>
		</div>
	{:else}
		<div class="table-scroll">
			<table class="movements">
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
							<td class="cell--nowrap">{movement.at}</td>
							<td>{movement.memberName}</td>
							<td>{movement.locationName}</td>
							<td class="cell--num">{movement.delta > 0 ? `+${movement.delta}` : movement.delta}</td>
							<td class="cell--num">{movement.resultQty}</td>
							<td>{movement.reason}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</OrgShell>
