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
	<h2>{title}</h2>
	{#if children}{@render children()}{/if}
</div>
