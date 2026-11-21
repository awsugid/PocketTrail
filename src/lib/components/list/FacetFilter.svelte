<script lang="ts">
 import * as Popover from '$lib/components/ui/popover';
 import * as Command from '$lib/components/ui/command';
 import { Button } from '$lib/components/ui/button';
 import { Badge } from '$lib/components/ui/badge';
 import { Checkbox } from '$lib/components/ui/checkbox';
 let { label, items, selected, onchange, members = false }: { label: string; items: { id: number; name: string; usageCount?: number }[]; selected: number[]; onchange: (id: number) => void; members?: boolean } = $props();
</script>
<Popover.Root>
 <Popover.Trigger>
  {#snippet child({ props })}<Button {...props} variant="outline" aria-label={label}>{label}{#if selected.length}<Badge variant="secondary">{selected.length}</Badge>{/if}</Button>{/snippet}
 </Popover.Trigger>
 <Popover.Content class="w-72 p-0" align="start">
  <Command.Root>
   <Command.Input placeholder={`Search ${label.toLowerCase()}…`} aria-label={`Search ${label.toLowerCase()}`} />
   <Command.List><Command.Empty>No matches.</Command.Empty><Command.Group>
    {#each items as item (item.id)}
     <Command.Item value={`${item.name} ${item.id}`} onSelect={() => onchange(item.id)} aria-label={item.name}>
      <Checkbox checked={selected.includes(item.id)} tabindex={-1} aria-label={`Select ${item.name}`} class="pointer-events-none" />
      {#if members}<span class="flex size-6 items-center justify-center rounded-full bg-muted text-xs" aria-hidden="true">{item.name.split(/\s+/).slice(0, 2).map(n => n[0]).join('')}</span>{/if}
      <span>{item.name}</span>{#if item.usageCount !== undefined}<span class="ml-auto text-muted-foreground tabular-nums">{item.usageCount}</span>{/if}
     </Command.Item>
    {/each}
   </Command.Group></Command.List>
  </Command.Root>
 </Popover.Content>
</Popover.Root>
