<script lang="ts">
	// Renders restricted Markdown (src/lib/markdown.ts) — safe by construction.
	import { renderMarkdown } from '#lib/markdown.ts';

	let { source, class: className = '' }: { source: string; class?: string } = $props();
	const html = $derived(renderMarkdown(source));
</script>

<div class="md {className}">{@html html}</div>
