<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';

	interface Props {
		title: string;
		icon?: IconName;
		back?: { href: string; label: string };
		/** Badges and facts under the title. */
		meta?: Snippet;
		actions?: Snippet;
	}

	let { title, icon, back, meta, actions }: Props = $props();
</script>

{#if back}
	<a class="crumb" href={back.href}><Icon name="back" size={16} />{back.label}</a>
{/if}
<div class="page-head">
	<h1>{#if icon}<Icon name={icon} size={22} />{/if}{title}</h1>
	{#if actions}<div class="page-head__actions">{@render actions()}</div>{/if}
	{#if meta}<p class="meta-line">{@render meta()}</p>{/if}
</div>
