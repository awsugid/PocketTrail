<script lang="ts">
	import { Checkbox } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { enhanced, onFormReset } from '$lib/controls.svelte';
	import Icon from '../Icon.svelte';

	interface Props {
		name: string;
		value?: string;
		checked?: boolean;
		disabled?: boolean;
		children: Snippet;
	}

	let { name, value = 'on', checked = $bindable(false), disabled = false, children: label }: Props = $props();
	const initial = checked;
</script>

<label class="check">
	{#if !enhanced.on}
		<input class="check__native" type="checkbox" {name} {value} {disabled} bind:checked />
	{:else}
		<span hidden {@attach onFormReset(() => (checked = initial))}></span>
		<Checkbox.Root class="ui-check" {name} {value} {disabled} bind:checked>
			{#snippet children({ checked: on })}
				{#if on}<Icon name="check" size={14} />{/if}
			{/snippet}
		</Checkbox.Root>
	{/if}
	{@render label()}
</label>
