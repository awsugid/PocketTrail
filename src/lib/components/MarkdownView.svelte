<script lang="ts">
	// Renders restricted Markdown (src/lib/markdown.ts) — safe by construction.
	import { renderMarkdown } from '#lib/markdown.ts';

	let { source, class: className = '', mentionNames }: { source: string; class?: string; mentionNames?: ReadonlyMap<string, string> } = $props();
	const html = $derived(renderMarkdown(source, mentionNames));
</script>

<div class="md {className}">{@html html}</div>
