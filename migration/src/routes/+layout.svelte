<script lang="ts">
	import '../app.css';
	let { children } = $props();
</script>

<div class="shell">
	{@render children()}
</div>
