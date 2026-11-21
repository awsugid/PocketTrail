<script lang="ts">
 import * as Select from './select';
 import { enhanced, onFormReset } from '$lib/controls.svelte';
 interface Props { id: string; name: string; items: { value: string; label: string }[]; value?: string; required?: boolean; disabled?: boolean; auto?: boolean; placeholder?: string; onchange?: (value: string) => void }
 let { id, name, items, value = $bindable(''), required = false, disabled = false, auto = false, placeholder = 'Choose…', onchange }: Props = $props();
 const initial = value;
 const selected = $derived(items.find(item => item.value === value));
</script>
{#if !enhanced.on}
<select class="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm" {id} {name} {required} {disabled} bind:value>{#if !items.some(item => item.value === '')}<option value="">{placeholder}</option>{/if}{#each items as item (item.value)}<option value={item.value}>{item.label}</option>{/each}</select>
{:else}
<span hidden {@attach onFormReset(() => value = initial)}></span>
<Select.Root type="single" {name} {items} {required} {disabled} bind:value onValueChange={onchange}>
 <Select.Trigger {id} data-field={name} class={auto ? 'w-auto' : 'w-full'} aria-required={required || undefined}>{selected?.label ?? placeholder}</Select.Trigger>
 <Select.Content>{#each items as item (item.value)}<Select.Item value={item.value} label={item.label}>{item.label}</Select.Item>{/each}</Select.Content>
</Select.Root>

{/if}
