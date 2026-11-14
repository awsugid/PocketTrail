<script lang="ts">
	import { Select } from 'bits-ui';
	import Icon from '../Icon.svelte';

	interface Props {
		id: string;
		name: string;
		items: Array<{ value: string; label: string }>;
		value?: string;
		required?: boolean;
		disabled?: boolean;
		/** Width follows the content instead of filling the field. */
		auto?: boolean;
		placeholder?: string;
		onchange?: (value: string) => void;
	}

	let { id, name, items, value = $bindable(items[0]?.value ?? ''), required = false, disabled = false, auto = false, placeholder = 'Choose', onchange }: Props = $props();

	const selected = $derived(items.find((item) => item.value === value));
</script>

<Select.Root type="single" {name} {items} {required} {disabled} bind:value onValueChange={(next) => onchange?.(next)}>
	<Select.Trigger {id} class="select ui-trigger {auto ? 'ui-trigger--auto' : ''}" aria-required={required || undefined}>
		<span class="ui-trigger__text" class:muted={!selected}>{selected?.label ?? placeholder}</span>
		<Icon name="caret" size={14} class="ui-trigger__caret" />
	</Select.Trigger>
	<Select.Portal>
		<Select.Content class="ui-popover" sideOffset={4} collisionPadding={12}>
			<Select.Viewport>
				{#each items as item (item.value)}
					<Select.Item class="ui-item" value={item.value} label={item.label}>
						{#snippet children({ selected })}
							<span class="ui-item__text">{item.label}</span>
							{#if selected}<Icon name="check" size={16} class="ui-item__check" />{/if}
						{/snippet}
					</Select.Item>
				{/each}
			</Select.Viewport>
		</Select.Content>
	</Select.Portal>
</Select.Root>
