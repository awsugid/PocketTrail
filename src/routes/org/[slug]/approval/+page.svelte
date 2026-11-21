<script lang="ts">
	import { fmtDate } from '$lib/fmt';
	import Empty from '$lib/components/Empty.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const slug = $derived(data.shell.org.slug);
</script>

<svelte:head><title>Approvals · {data.shell.org.name}</title></svelte:head>

<OrgShell {...data.shell} active="approval">
	<PageHead title="Approvals" icon="check" />
	{#if data.review.length === 0}
		<div class="panel"><Empty icon="check" title="No approvals awaiting your review" /></div>
	{:else}
		<section class="panel" aria-labelledby="review-heading">
			<div class="panel__head">
				<Icon name="check" size={16} /><h2 id="review-heading">To review</h2>
				<span class="count">{data.review.length}</span>
			</div>
			<ul class="rows rows--link">
				{#each data.review as task}
					<li><a href="/org/{slug}/purposes/{task.purposeId}">
						<span class="rows__main"><strong>{task.purposeName}</strong><span class="rows__sub">{fmtDate(task.txnDate)} · {task.pocketName} · {task.counterparty}</span></span>
						<span class="badge badge--review">Awaiting review</span><Icon name="chevron" size={16} class="tail" />
					</a></li>
				{/each}
			</ul>
		</section>
	{/if}

</OrgShell>
