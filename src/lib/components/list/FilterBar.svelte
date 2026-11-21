<script lang="ts">
 import { goto } from '$app/navigation';
 import { page } from '$app/state';
 import { parseDate, type DateValue } from '@internationalized/date';
 import { Button } from '$lib/components/ui/button';
 import { Input } from '$lib/components/ui/input';
 import { Label } from '$lib/components/ui/label';
 import { Badge } from '$lib/components/ui/badge';
 import * as Popover from '$lib/components/ui/popover';
 import * as ToggleGroup from '$lib/components/ui/toggle-group';
 import { RangeCalendar } from '$lib/components/ui/range-calendar';
 import Icon from '../Icon.svelte';
 import SearchIcon from '@lucide/svelte/icons/search';
 import FacetFilter from './FacetFilter.svelte';
 import { fmtDate, fmtMoney, rupiahInput } from '$lib/fmt';
 import { filterHref, statuses } from './helpers';
 interface Selection { q: string; status: string | null; from: string | null; to: string | null; min: number | null; max: number | null; dir: string | null; kind: string | null; tag: number[]; responsible: number[]; actor: number[]; purpose: number[]; }
 interface Options { tags: { id: number; name: string; usageCount: number }[]; members: { id: number; name: string }[]; actors: { id: number; name: string; pattern: string; pocketId: number }[]; purposes: { id: number; name: string }[]; }
 let { selection, options, purposes = false, needsActionCount = 0 }: { selection: Selection; options: Options; purposes?: boolean; needsActionCount?: number } = $props();
 let open = $state(false);
 let query = $state('');
 let draft = $state<Selection>(null!);
 let range = $state<{ start: DateValue | undefined; end: DateValue | undefined }>({ start: undefined, end: undefined });
 $effect(() => { query = selection.q; });
 function navigate(href: string) { return goto(href, { keepFocus: true, replaceState: true, noScroll: true }); }
 function change(key: string, value: string, toggle = false) { void navigate(filterHref(page.url, key, value, toggle)); }
 $effect(() => {
  const value = query;
  if (value === selection.q) return;
  const timer = setTimeout(() => change('q', value), 300);
  return () => clearTimeout(timer);
 });
 function begin() {
  draft = structuredClone(selection);
  range = { start: selection.from ? parseDate(selection.from) : undefined, end: selection.to ? parseDate(selection.to) : undefined };
 }
 function toggleDraft(key: 'tag' | 'responsible' | 'actor' | 'purpose', id: number) { draft[key] = draft[key].includes(id) ? draft[key].filter(n => n !== id) : [...draft[key], id]; }
 function apply(event: SubmitEvent) {
  event.preventDefault();
  const form = new FormData(event.currentTarget as HTMLFormElement);
  const params = new URLSearchParams(page.url.search);
  for (const key of ['min', 'max', 'dir', 'from', 'to', 'tag', 'responsible', 'actor', 'purpose', 'page']) params.delete(key);
  for (const key of ['min', 'max']) { const value = String(form.get(key) ?? '').trim(); if (value) params.set(key, value); }
  if (!purposes) {
   if (draft.dir) params.set('dir', draft.dir);
   if (range.start) params.set('from', range.start.toString());
   if (range.end) params.set('to', range.end.toString());
  }
  for (const key of ['tag', 'responsible', 'actor', 'purpose'] as const) for (const id of draft[key]) params.append(key, String(id));
  open = false;
  void navigate(`${page.url.pathname}${params.size ? `?${params}` : ''}`);
 }
 const tags = $derived([...options.tags].sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name)));
 const popupCount = $derived(Number(selection.min !== null || selection.max !== null) + selection.responsible.length + (purposes ? selection.tag.length : Number(!!selection.from || !!selection.to) + Number(!!selection.dir) + selection.actor.length + selection.purpose.length));
 const chips = $derived.by(() => {
  const result: { label: string; keys: string[]; value?: string }[] = [];
  if (selection.q) result.push({ label: `Search: ${selection.q}`, keys: ['q'] });
  if (selection.status) result.push({ label: statuses.find(s => s.value === selection.status)?.label ?? selection.status, keys: ['status'] });
  if (selection.kind) result.push({ label: `Kind: ${selection.kind}`, keys: ['kind'] });
  if (selection.dir) result.push({ label: `Direction: ${selection.dir === 'in' ? 'In' : 'Out'}`, keys: ['dir'] });
  if (selection.from || selection.to) result.push({ label: `Date: ${selection.from ? fmtDate(selection.from) : 'Any'} – ${selection.to ? fmtDate(selection.to) : 'Any'}`, keys: ['from', 'to'] });
  if (selection.min !== null || selection.max !== null) result.push({ label: `${purposes ? 'Total' : 'Amount'}: ${selection.min !== null ? fmtMoney(selection.min) : 'Any'} – ${selection.max !== null ? fmtMoney(selection.max) : 'Any'}`, keys: ['min', 'max'] });
  for (const group of [{ key: 'tag', label: 'Tag', items: tags }, { key: 'responsible', label: 'Responsible', items: options.members }, { key: 'actor', label: 'Actor', items: options.actors }, { key: 'purpose', label: 'Purpose', items: options.purposes }] as const) for (const id of selection[group.key]) result.push({ label: `${group.label}: ${group.items.find(i => i.id === id)?.name ?? id}`, keys: [group.key], value: String(id) });
  return result;
 });
 function remove(chip: typeof chips[number]) {
  const params = new URLSearchParams(page.url.search);
  for (const key of chip.keys) { if (chip.value) params.delete(key, chip.value); else params.delete(key); }
  params.delete('page');
  void navigate(`${page.url.pathname}${params.size ? `?${params}` : ''}`);
 }
</script>

<div class="mb-4" data-list-filters>
 <div class="flex items-center gap-2 overflow-x-auto pb-1" aria-label="List filters">
  <form class="relative min-w-36 flex-1" role="search" aria-label={purposes ? 'Search purposes' : 'Search ledger'} onsubmit={(event) => { event.preventDefault(); change('q', query); }}>
   <span class="pointer-events-none absolute left-2 top-2 text-muted-foreground"><SearchIcon size={16} /></span>
   <Input type="search" id="list-search" name="q" aria-label="Search" bind:value={query} maxlength={300} placeholder={purposes ? 'Search purposes…' : 'Search ledger…'} class="pl-8" />
  </form>
  <Button variant="outline" aria-pressed={selection.status === 'needs_action'} class={selection.status === 'needs_action' ? 'bg-muted' : ''} onclick={() => change('status', selection.status === 'needs_action' ? '' : 'needs_action')}>Needs your action <Badge variant="secondary">{needsActionCount}</Badge></Button>
  <nav aria-label="Status filter"><ToggleGroup.Root type="single" variant="outline" size="sm" value={selection.status === 'needs_action' ? '' : selection.status || 'all'} onValueChange={value => change('status', value === 'all' ? '' : value)}>
   {#each statuses.filter(s => s.value !== 'needs_action') as option (option.value)}<ToggleGroup.Item value={option.value || 'all'}>{option.label}</ToggleGroup.Item>{/each}
  </ToggleGroup.Root></nav>
  {#if purposes}<ToggleGroup.Root type="single" variant="outline" size="sm" aria-label="Purpose kind filter" value={selection.kind || 'all'} onValueChange={value => change('kind', value === 'all' ? '' : value)}>{#each ['All', 'Expense', 'Income'] as kind}<ToggleGroup.Item value={kind === 'All' ? 'all' : kind.toLowerCase()}>{kind}</ToggleGroup.Item>{/each}</ToggleGroup.Root>{/if}
  <FacetFilter label="Tags" items={tags} selected={selection.tag} onchange={id => change('tag', String(id), true)} />
  <Popover.Root bind:open onOpenChange={value => { if (value) begin(); }}>
   <Popover.Trigger>{#snippet child({ props })}<Button {...props} variant="outline" aria-label={`Filters${popupCount ? `, ${popupCount} active` : ''}`}><Icon name="filter" size={16} />Filters{#if popupCount}<Badge variant="secondary">{popupCount}</Badge>{/if}</Button>{/snippet}</Popover.Trigger>
   <Popover.Content align="end" class="w-[min(420px,calc(100vw-24px))] max-h-[80vh] overflow-y-auto">
    {#if draft}<form class="flex flex-col gap-4" onsubmit={apply}>
     <h2>Filters</h2>
     {#if !purposes}<div class="flex flex-col gap-2"><Label>Date range</Label><Popover.Root><Popover.Trigger>{#snippet child({ props })}<Button {...props} variant="outline" class="justify-start" aria-label="Date range">{range.start ? fmtDate(range.start.toString()) : 'Start date'} – {range.end ? fmtDate(range.end.toString()) : 'End date'}</Button>{/snippet}</Popover.Trigger><Popover.Content class="w-auto p-0"><RangeCalendar bind:value={range} locale="en-GB" /></Popover.Content></Popover.Root></div>{/if}
     <div class="grid grid-cols-2 gap-3">{#each ['min', 'max'] as bound}<div class="flex flex-col gap-2"><Label for={`filter-${bound}`}>{purposes ? 'Total' : 'Amount'} {bound} (IDR)</Label><div class="relative"><span class="absolute left-2 top-1 text-muted-foreground">Rp</span><Input id={`filter-${bound}`} name={bound} type="number" inputmode="decimal" min="0" step="0.01" class="pl-8" value={draft[bound as 'min' | 'max'] === null ? '' : rupiahInput(draft[bound as 'min' | 'max']!)} /></div></div>{/each}</div>
     {#if !purposes}<div class="flex flex-col gap-2"><Label>Direction</Label><ToggleGroup.Root type="single" variant="outline" value={draft.dir || 'all'} onValueChange={value => draft.dir = value === 'all' ? null : value}><ToggleGroup.Item value="all">All</ToggleGroup.Item><ToggleGroup.Item value="in">In</ToggleGroup.Item><ToggleGroup.Item value="out">Out</ToggleGroup.Item></ToggleGroup.Root></div>{/if}
     <FacetFilter label="Responsible member" items={options.members} selected={draft.responsible} onchange={id => toggleDraft('responsible', id)} members />
     {#if !purposes}<FacetFilter label="Actor" items={options.actors.map(actor => ({ ...actor, name: `${actor.name} · ${actor.pattern} · Pocket ${actor.pocketId}` }))} selected={draft.actor} onchange={id => toggleDraft('actor', id)} /><FacetFilter label="Purpose" items={options.purposes} selected={draft.purpose} onchange={id => toggleDraft('purpose', id)} />{:else}<FacetFilter label="Tag" items={tags} selected={draft.tag} onchange={id => toggleDraft('tag', id)} />{/if}
     <div class="flex gap-2"><Button type="submit">Apply</Button><Button variant="outline" onclick={() => { open = false; void navigate(page.url.pathname); }}>Reset</Button><Button variant="ghost" onclick={() => open = false}>Cancel</Button></div>
    </form>{/if}
   </Popover.Content>
  </Popover.Root>
 </div>
 {#if chips.length}<div class="mt-2 flex flex-wrap items-center gap-2" aria-label="Active filters">{#each chips as chip (chip.label)}<Badge variant="secondary" class="gap-1">{chip.label}<Button variant="ghost" size="icon-xs" type="button" class="inline-flex rounded-sm focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Remove ${chip.label}`} onclick={() => remove(chip)}><Icon name="close" size={12} /></Button></Badge>{/each}<Button variant="ghost" size="sm" onclick={() => void navigate(page.url.pathname)}>Clear all</Button></div>{/if}
</div>
