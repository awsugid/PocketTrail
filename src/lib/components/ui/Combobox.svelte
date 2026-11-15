<script lang="ts">
	import { Combobox } from 'bits-ui';
	import { enhanced, onFormReset } from '$lib/controls.svelte';
	import Icon from '../Icon.svelte';

	interface Props {
		id: string;
		name: string;
		/** Known values to pick from. Typing a value that is not listed is allowed. */
		options: string[];
		value?: string;
		required?: boolean;
		maxlength?: number;
	}

	let { id, name, options, value = $bindable(''), required = false, maxlength }: Props = $props();
	const initial = value;

	let open = $state(false);
	// One normalised query: a whitespace-only value is empty everywhere.
	const q = $derived(value.trim().toLowerCase());
	const matches = $derived(options.filter((option) => option.toLowerCase().includes(q)));
	const isNew = $derived(q !== '' && !options.some((option) => option.toLowerCase() === q));
</script>

<!-- The visible input is the field: it carries name, required and maxlength, so the
     typed text (or a picked option) posts as-is, with or without JavaScript. -->
{#if !enhanced.on}
	<input class="input" {id} {name} {required} {maxlength} autocomplete="off" bind:value />
{:else}
<span hidden {@attach onFormReset(() => (value = initial))}></span>
<Combobox.Root type="single" items={options.map((option) => ({ value: option, label: option }))} bind:open inputValue={value} onValueChange={(next: string) => (value = next)}>
	<div class="ui-combo">
		<Combobox.Input {id} {name} {required} class="input" {maxlength} autocomplete="off" oninput={(event) => ((value = event.currentTarget.value), (open = true))} onclick={() => (open = true)} />
		<Combobox.Trigger class="ui-combo__trigger" aria-label="Show known labels"><Icon name="caret" size={14} /></Combobox.Trigger>
	</div>
	<Combobox.Portal>
		<Combobox.Content class="ui-popover" sideOffset={4} collisionPadding={12}>
			<Combobox.Viewport>
				{#each matches as option (option)}
					<Combobox.Item class="ui-item" value={option} label={option}>
						{#snippet children({ selected })}
							<span class="ui-item__text">{option}</span>
							{#if selected}<Icon name="check" size={16} class="ui-item__check" />{/if}
						{/snippet}
					</Combobox.Item>
				{/each}
				{#if isNew}
					<div class="ui-note"><Icon name="plus" size={14} />New label “{value.trim()}”</div>
				{:else if matches.length === 0}
					<div class="ui-note">No known labels</div>
				{/if}
			</Combobox.Viewport>
		</Combobox.Content>
	</Combobox.Portal>
</Combobox.Root>
{/if}
