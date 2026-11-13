<script lang="ts">
	import { page } from '$app/state';

	// Titles mirror fail() in src/web/mod.rs; form rejections (400/409) keep
	// the "entries not saved" recovery hint, navigations do not.
	const title = $derived(
		page.status === 400
			? 'Could not save'
			: page.status === 403
				? 'Not allowed'
				: page.status === 404
					? 'Not found'
					: page.status === 409
						? 'Out of date'
						: page.status === 503
							? 'Not configured'
							: 'Something went wrong'
	);
	const showRecovery = $derived(page.status === 400 || page.status === 409);
</script>

<svelte:head>
	<title>{title} · PocketTrail</title>
</svelte:head>

<main class="auth-column">
	<h1>{title}</h1>
	<p class="lede">{page.error?.message ?? 'The request could not be completed.'}</p>
	{#if showRecovery}
		<p class="hint">Your entries were not saved. Use your browser's Back button to return to the form.</p>
	{/if}
	<p><a class="btn" href="/orgs">Back to organizations</a></p>
</main>

<style>
	.hint {
		color: var(--text-secondary);
		font-size: 13px;
	}
</style>
