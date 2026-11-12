<script lang="ts">
	import { page } from '$app/state';

	const title = $derived(
		page.status === 403
			? 'Not allowed'
			: page.status === 404
				? 'Not found'
				: page.status === 503
					? 'Not configured'
					: 'Something went wrong'
	);
</script>

<svelte:head>
	<title>{title} · PocketTrail</title>
</svelte:head>

<main class="auth-column">
	<h1>{title}</h1>
	<p class="lede">{page.error?.message ?? 'The request could not be completed.'}</p>
	<p><a class="btn" href="/orgs">Back to organizations</a></p>
</main>
