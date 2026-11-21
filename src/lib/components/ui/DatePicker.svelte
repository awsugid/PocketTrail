<script lang="ts">
 import * as Popover from './popover';
 import { Calendar } from './calendar';
 import { Button } from './button';
 import { Input } from './input';
 import { CalendarDate, type DateValue } from '@internationalized/date';
 import { enhanced, onFormReset } from '#lib/controls.svelte.ts';
 import { fmtDate } from '#lib/fmt.ts';
 import Icon from '../Icon.svelte';
 let { id, name, value = $bindable(''), required = false, clearable = false, form }: { id: string; name: string; value?: string; required?: boolean; clearable?: boolean; form?: string } = $props();
 const initial = value;
 const parse = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? new CalendarDate(Number(m[1]), Number(m[2]), Number(m[3])) : undefined; };
 let open = $state(false);
 let picked = $state<DateValue | undefined>(parse(value));
 $effect(() => { picked = parse(value); });
</script>
{#if !enhanced.on}<Input {id} {name} {form} {required} type="date" bind:value />{:else}
<span hidden {@attach onFormReset(() => value = initial)}></span>
<Popover.Root bind:open>
 <Popover.Trigger>{#snippet child({ props })}<Button {...props} {id} data-field={name} variant="outline" class="w-full justify-between font-normal" aria-required={required || undefined} onkeydown={event => { if (clearable && (event.key === 'Backspace' || event.key === 'Delete')) value = ''; }}>{value ? fmtDate(value) : 'Pick a date'}<Icon name="calendar" size={16} /></Button>{/snippet}</Popover.Trigger>
 <Input class="visually-hidden" tabindex={-1} aria-hidden="true" {name} {form} {value} {required} onfocus={() => document.getElementById(id)?.focus()} />
 <Popover.Content class="w-auto p-0" align="start" aria-label="Choose a date"><Calendar type="single" bind:value={picked} preventDeselect onValueChange={next => { value = next?.toString() ?? ''; open = false; }} />{#if clearable && value}<Button variant="ghost" onclick={() => { value = ''; open = false; }}>Clear</Button>{/if}</Popover.Content>
</Popover.Root>

{/if}
