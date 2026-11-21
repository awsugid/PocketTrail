<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { enhanced } from '#lib/controls.svelte.ts';
	import { leaveGuard } from '#lib/forms.ts';

	let { children } = $props();
	leaveGuard();
	onMount(() => (enhanced.on = true));
</script>

<a class="skip-link" href="#main">Skip to content</a>
{@render children()}
