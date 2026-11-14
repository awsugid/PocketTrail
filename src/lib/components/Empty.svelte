<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';

	interface Props {
		icon: IconName;
		title: string;
		inline?: boolean;
		children?: Snippet;
	}

	let { icon, title, inline = false, children }: Props = $props();
</script>

<div class="empty" class:empty--inline={inline}>
	<Icon name={icon} size={32} />
	{#if inline}<h3>{title}</h3>{:else}<h2>{title}</h2>{/if}
	{#if children}{@render children()}{/if}
</div>
