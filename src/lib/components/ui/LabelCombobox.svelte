<script lang="ts">
 import { Input } from './input';
 import { Button } from './button';
 import * as Popover from './popover';
 import * as Command from './command';
 import { onFormReset } from '$lib/controls.svelte';
 let { id, name, options, value = $bindable(''), required = false, maxlength }: { id: string; name: string; options: string[]; value?: string; required?: boolean; maxlength?: number } = $props();
 const initial = value;
 let open = $state(false);
</script>
<span hidden {@attach onFormReset(() => value = initial)}></span>
<div class="flex items-center gap-2">
 <Input {id} {name} {required} {maxlength} autocomplete="off" bind:value />
 <Popover.Root bind:open><Popover.Trigger>{#snippet child({ props })}<Button {...props} variant="outline" aria-label="Show known labels">Choose</Button>{/snippet}</Popover.Trigger>
 <Popover.Content class="p-0"><Command.Root><Command.Input placeholder="Search labels…" /><Command.List><Command.Empty>No known labels. Type a new label in the field.</Command.Empty><Command.Group>{#each options as option (option)}<Command.Item value={option} onSelect={() => { value = option; open = false; document.getElementById(id)?.focus(); }}>{option}</Command.Item>{/each}</Command.Group></Command.List></Command.Root></Popover.Content></Popover.Root>
</div>
