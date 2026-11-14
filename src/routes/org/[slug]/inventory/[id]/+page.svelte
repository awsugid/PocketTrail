<script lang="ts">
	import Empty from '$lib/components/Empty.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
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

	<div class="panel">
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
	</div>
</OrgShell>
