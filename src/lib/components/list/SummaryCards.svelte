<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import Icon, { type IconName } from '$lib/components/Icon.svelte';

	let { items }: { items: { label: string; value: string | number; icon: IconName; tone?: string; detail?: string; title?: string }[] } = $props();
</script>

<dl class="list-summary" aria-label="Filtered summary">
	<Tooltip.Provider delayDuration={0}>
		{#each items as item (item.label)}
			<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard focus exposes the card tooltip.) -->
					<div {...props} data-tone={item.tone} tabindex="0" role="group" aria-label={`${item.title ?? item.label}: ${item.value}${item.detail ? `, ${item.detail}` : ''}`}>
						<dt><Icon name={item.icon} size={16} /></dt>
						<dd style:font-size="{Math.min(20, 200 / String(item.value).length + 8)}px">{item.value}</dd>
						{#if item.detail}<small>{item.detail}</small>{/if}
					</div>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Portal><Tooltip.Content role="tooltip" class="member-tooltip" sideOffset={4}>{item.title ?? item.label}</Tooltip.Content></Tooltip.Portal>
		</Tooltip.Root>
		{/each}
	</Tooltip.Provider>
</dl>
