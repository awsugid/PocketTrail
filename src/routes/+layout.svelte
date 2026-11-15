<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { enhanced } from '$lib/controls.svelte';
	import { leaveGuard } from '$lib/forms';

	let { children } = $props();
	leaveGuard();
	onMount(() => (enhanced.on = true));
</script>

<a class="skip-link" href="#main">Skip to content</a>
{@render children()}
