<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let { children }: { children: Snippet } = $props();
</script>

<main class="auth" id="main" tabindex="-1">
	<a class="brand" href="/orgs">
		<span class="brand__mark"><Icon name="pocket" size={16} /></span>PocketTrail
	</a>
	{@render children()}
</main>
