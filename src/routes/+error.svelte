<script lang="ts">
	import { page } from '$app/state';
	import AuthFrame from '$lib/components/AuthFrame.svelte';
	import Icon from '$lib/components/Icon.svelte';

	const title = $derived(
		(
			{ 400: 'Could not save', 403: 'Not allowed', 404: 'Page not found', 409: 'Out of date', 503: 'Not configured' } as Record<
				number,
				string
			>
		)[page.status] ?? 'Something went wrong'
	);
</script>

<svelte:head>
	<title>{title} · PocketTrail</title>
</svelte:head>

<AuthFrame>
	<div class="panel">
		<div class="empty">
			<Icon name="alert" size={32} />
			<h1>{title}</h1>
			<p class="muted">{page.status}{page.error?.message ? ` · ${page.error.message}` : ''}</p>
			{#if page.status === 400 || page.status === 409}
				<p>Nothing was saved. Go back to keep what you typed.</p>
			{/if}
			<a class="btn" href="/orgs"><Icon name="back" size={16} />Organizations</a>
		</div>
	</div>
</AuthFrame>
