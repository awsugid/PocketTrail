<script lang="ts">
	import { tick } from 'svelte';
	import { Check, ChevronsUpDown } from '@lucide/svelte';
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import * as Command from '#lib/components/ui/command/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';

	type Member = { id: number; name: string; handle?: string | null; role?: string };
	let {
		members, name, multiple = false, value = $bindable(''), placeholder = 'Select a member',
		allowNone = false, noneLabel = 'No responsible member', disabled = false, id,
		'aria-labelledby': labelledBy
	}: {
		members: Member[]; name: string; multiple?: boolean; value?: string | string[];
		placeholder?: string; allowNone?: boolean; noneLabel?: string; disabled?: boolean;
		id?: string; 'aria-labelledby'?: string;
	} = $props();

	let open = $state(false);
	let trigger = $state<HTMLButtonElement>(null!);
	let search = $state<HTMLInputElement>(null!);
	const selected = $derived(Array.isArray(value) ? value : value ? [value] : []);
	const chosen = $derived(members.filter((member) => selected.includes(String(member.id))));

	function update(next: string | string[]) {
		value = next;
		void tick().then(() => trigger?.dispatchEvent(new Event('change', { bubbles: true })));
	}

	function select(id: string) {
		if (multiple) {
			update(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
		} else {
			update(id);
			open = false;
			void tick().then(() => trigger?.focus());
		}
	}
</script>

{#if multiple}
	{#each chosen as member (member.id)}
		<input type="hidden" {name} value={String(member.id)} {disabled} />
	{/each}
{:else}
	<input type="hidden" {name} value={selected[0] ?? ''} {disabled} />
{/if}

<Popover.Root bind:open>
	<Popover.Trigger bind:ref={trigger} {id} {disabled}>
		{#snippet child({ props })}
			<Button {...props} type="button" variant="outline" role="combobox" aria-expanded={open}
				aria-labelledby={labelledBy} class="h-auto min-h-9 w-full min-w-0 justify-between text-left font-normal">
				{#if multiple && chosen.length}
					<span class="flex min-w-0 items-center gap-1">
						{#each chosen.slice(0, 2) as member (member.id)}
							<Badge variant="secondary" class="min-w-0"><span class="truncate">{member.name}</span></Badge>
						{/each}
						{#if chosen.length > 2}<Badge variant="secondary" class="shrink-0">+{chosen.length - 2}</Badge>{/if}
					</span>
				{:else}
					<span class="truncate" class:text-muted-foreground={!chosen.length && (multiple || !allowNone)}>
						{chosen[0]?.name ?? (!multiple && allowNone && !selected.length ? noneLabel : placeholder)}
					</span>
				{/if}
				<ChevronsUpDown class="shrink-0 text-muted-foreground" aria-hidden="true" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="start" class="w-(--bits-popover-anchor-width) min-w-60 p-0"
		onOpenAutoFocus={(event) => { event.preventDefault(); search?.focus(); }}>
		<Command.Root>
			<Command.Input bind:ref={search} placeholder="Search members…" aria-label="Search members" />
			<Command.List>
				<Command.Empty>No member found.</Command.Empty>
				<Command.Group>
					{#if !multiple && allowNone}
						<Command.Item value={noneLabel} data-checked={!selected.length} onSelect={() => select('')}>
							<span class="min-w-0 flex-1">{noneLabel}</span>
							{#if !selected.length}<Check aria-hidden="true" />{/if}
						</Command.Item>
					{/if}
					{#each members as member (member.id)}
						{@const checked = selected.includes(String(member.id))}
						<Command.Item value={String(member.id)} keywords={[member.name, member.handle ?? '']}
							data-checked={checked} aria-label={checked ? `${member.name}, selected` : member.name}
							onSelect={() => select(String(member.id))}>
							<span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs" aria-hidden="true">
								{member.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
							</span>
							<span class="min-w-0 flex-1 truncate">{member.name}</span>
							{#if checked}<Check aria-hidden="true" />{/if}
						</Command.Item>
					{/each}
				</Command.Group>
			</Command.List>
		</Command.Root>
		{#if multiple}
			<div class="flex items-center justify-between border-t px-3 py-1 text-xs text-muted-foreground">
				<span aria-live="polite">{chosen.length} selected</span>
				<Button type="button" size="sm" variant="ghost" disabled={!chosen.length}
					onclick={() => { update([]); search?.focus(); }}>Clear</Button>
			</div>
		{/if}
	</Popover.Content>
</Popover.Root>
