<script lang="ts">
	import { Select } from 'bits-ui';
	import { enhanced, onFormReset } from '$lib/controls.svelte';
	import Icon from '../Icon.svelte';

	interface Props {
		id: string;
		name: string;
		items: Array<{ value: string; label: string }>;
		/** Selected value. '' (the default) shows the "Choose…" state: nothing is preselected. */
		value?: string;
		required?: boolean;
		disabled?: boolean;
		/** Width follows the content instead of filling the field. */
		auto?: boolean;
		placeholder?: string;
		onchange?: (value: string) => void;
	}

	let { id, name, items, value = $bindable(''), required = false, disabled = false, auto = false, placeholder = 'Choose…', onchange }: Props = $props();

	const initial = value;
	const selected = $derived(items.find((item) => item.value === value));
	// An item with value '' (for example "Unassigned") is itself the empty choice.
	const hasEmptyItem = $derived(items.some((item) => item.value === ''));
</script>

{#if !enhanced.on}
	<!-- No-JS baseline: the server renders a native select that posts the same field. -->
	<select class="select" {id} {name} {required} {disabled} bind:value>
		{#if !hasEmptyItem}<option value="">{placeholder}</option>{/if}
		{#each items as item (item.value)}
			<option value={item.value}>{item.label}</option>
		{/each}
	</select>
{:else}
	<span hidden {@attach onFormReset(() => (value = initial))}></span>
	<Select.Root type="single" {name} {items} {required} {disabled} bind:value onValueChange={(next) => onchange?.(next)}>
		<Select.Trigger {id} data-field={name} class="select ui-trigger {auto ? 'ui-trigger--auto' : ''}" aria-required={required || undefined}>
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
{/if}
