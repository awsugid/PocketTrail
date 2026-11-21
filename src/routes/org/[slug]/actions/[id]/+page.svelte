<script lang="ts">
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>
<svelte:head><title>Explain expense · {data.shell.org.name}</title></svelte:head>
<OrgShell {...data.shell} active="actions">
	<PageHead title="Explain expense" icon="comment" />
	<section class="panel">
		<h2>{data.task.counterparty}</h2>
		<p>{data.task.txn_date}</p>
		<form method="POST" class="stack">
			<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
			<input type="hidden" name="revision" value={data.task.revision} />
			<label for="explanation">Why did this expense happen? What was its purpose?</label>
			<textarea id="explanation" name="explanation" required maxlength="10000" rows="6">{data.task.explanation}</textarea>
			<button class="btn" type="submit">Save explanation</button>
		</form>
	</section>
</OrgShell>
