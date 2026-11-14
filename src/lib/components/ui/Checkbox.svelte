<script lang="ts">
	import { Checkbox } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import Icon from '../Icon.svelte';

	interface Props {
		name: string;
		value?: string;
		checked?: boolean;
		children: Snippet;
	}

	let { name, value = 'on', checked = $bindable(false), children: label }: Props = $props();
</script>

<label class="check">
	<Checkbox.Root class="ui-check" {name} {value} bind:checked>
		{#snippet children({ checked: on })}
			{#if on}<Icon name="check" size={14} />{/if}
		{/snippet}
	</Checkbox.Root>
	{@render label()}
</label>
