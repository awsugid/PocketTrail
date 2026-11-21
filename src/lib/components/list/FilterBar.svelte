<script lang="ts">
	import { Popover } from 'bits-ui';
	import { page } from '$app/state';
	import Icon from '../Icon.svelte';
	import { rupiahInput } from '$lib/fmt';
	import { filterHref, statuses } from './helpers';

	interface Selection {
		q: string; status: string | null; from: string | null; to: string | null; min: number | null; max: number | null;
		dir: string | null; kind: string | null; tag: number[]; responsible: number[]; actor: number[]; purpose: number[];
	}
	interface Options {
		tags: { id: number; name: string; usageCount: number }[];
		members: { id: number; name: string }[];
		actors: { id: number; name: string; pattern: string; pocketId: number }[];
		purposes: { id: number; name: string }[];
	}
	let { selection, options, purposes = false }: { selection: Selection; options: Options; purposes?: boolean } = $props();
	let open = $state(false);
	let tagSearch = $state('');
	const tags = $derived([...options.tags].sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name)));
	const extraTags = $derived(tags.slice(8).filter(tag => tag.name.toLowerCase().includes(tagSearch.toLowerCase())));
	const popupCount = $derived([selection.status, selection.min !== null, selection.max !== null, ...(purposes ? [selection.kind] : [selection.from, selection.to, selection.dir])].filter(Boolean).length + selection.tag.length + selection.responsible.length + (purposes ? 0 : selection.actor.length + selection.purpose.length));
	const groups = $derived([
		{ key: 'responsible', label: 'Responsible member', selected: selection.responsible, items: options.members },
		...(!purposes ? [{ key: 'actor', label: 'Actor', selected: selection.actor, items: options.actors.map(actor => ({ id: actor.id, name: `${actor.name} · ${actor.pattern} · Pocket ${actor.pocketId}` })) }, { key: 'purpose', label: 'Purpose', selected: selection.purpose, items: options.purposes }] : []),
		{ key: 'tag', label: 'Tag', selected: selection.tag, items: tags }
	]);
</script>

<div class="list-filters">
	<div class="list-filters__row">
		<form method="GET" action={page.url.pathname} class="list-search" role="search" aria-label={purposes ? 'Search purposes' : 'Search ledger'}>
			{#each [...page.url.searchParams].filter(([key]) => key !== 'q' && key !== 'page') as [key, value], index (index)}<input type="hidden" name={key} {value} />{/each}
			<label class="visually-hidden" for="list-search">Search</label>
			<input class="input" type="search" id="list-search" name="q" value={selection.q} maxlength="300" placeholder={purposes ? 'Search purposes…' : 'Search ledger…'} />
			<button class="btn btn--sm" type="submit">Search</button>
		</form>
		<nav class="chips" aria-label="Status filter">
			{#each statuses as option (option.value)}
				<a class="chip" href={filterHref(page.url, 'status', option.value)} aria-current={(selection.status ?? '') === option.value ? 'true' : undefined}>{option.label}</a>
			{/each}
		</nav>
		{#if purposes}
			<nav class="chips" aria-label="Purpose kind filter">
				{#each [{ value: '', label: 'All' }, { value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }] as option (option.value)}
				<a class="chip" href={filterHref(page.url, 'kind', option.value)} aria-current={(selection.kind ?? '') === option.value ? 'true' : undefined}>{option.label}</a>
				{/each}
			</nav>
		{/if}
		<Popover.Root bind:open>
			<Popover.Trigger class="btn btn--sm list-filters__trigger" aria-label={`Filters${popupCount ? `, ${popupCount} active` : ''}`}><Icon name="filter" size={16} />Filters{#if popupCount}<span class="filter-count">{popupCount}</span>{/if}</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content class="ui-popover list-filter-popup" sideOffset={8} collisionPadding={12} align="end">
					<h2>Filters</h2>
					{#key page.url.search}
					<form method="GET" action={page.url.pathname} class="form">
						{#if selection.q}<input type="hidden" name="q" value={selection.q} />{/if}
						{#if !purposes}
							<div class="filter-pair">
								<div class="field"><label for="filter-from">Date from</label><input class="input" type="date" id="filter-from" name="from" value={selection.from ?? ''} /></div>
								<div class="field"><label for="filter-to">Date to</label><input class="input" type="date" id="filter-to" name="to" value={selection.to ?? ''} /></div>
							</div>
						{/if}
						<div class="filter-pair">
							<div class="field"><label for="filter-min">{purposes ? 'Total' : 'Amount'} min (IDR)</label><input class="input" type="number" min="0" step="0.01" id="filter-min" name="min" value={selection.min === null ? '' : rupiahInput(selection.min)} /></div>
							<div class="field"><label for="filter-max">{purposes ? 'Total' : 'Amount'} max (IDR)</label><input class="input" type="number" min="0" step="0.01" id="filter-max" name="max" value={selection.max === null ? '' : rupiahInput(selection.max)} /></div>
						</div>
						<div class="filter-pair">
							<div class="field"><label for="filter-direction">{purposes ? 'Kind' : 'Direction'}</label>
								<select class="select" id="filter-direction" name={purposes ? 'kind' : 'dir'}>
									<option value="">All</option>
									{#each purposes ? [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }] : [{ value: 'in', label: 'In' }, { value: 'out', label: 'Out' }] as option (option.value)}<option value={option.value} selected={(purposes ? selection.kind : selection.dir) === option.value}>{option.label}</option>{/each}
								</select>
							</div>
							<div class="field"><label for="filter-status">Status</label><select class="select" id="filter-status" name="status">{#each statuses as option (option.value)}<option value={option.value} selected={(selection.status ?? '') === option.value}>{option.label}</option>{/each}</select></div>
						</div>
						{#each groups as group (group.key)}
							<fieldset class="filter-group"><legend>{group.label}</legend><div class="filter-options">
								{#each group.items as item (item.id)}<label class="check"><input type="checkbox" name={group.key} value={item.id} checked={group.selected.includes(item.id)} />{item.name}</label>{:else}<span class="muted">None available</span>{/each}
							</div></fieldset>
						{/each}
						<div class="form-actions"><button class="btn btn--primary" type="submit">Apply</button><a class="btn" href={page.url.pathname} onclick={() => open = false}>Clear</a><Popover.Close class="btn btn--quiet" type="button">Cancel</Popover.Close></div>
					</form>
					{/key}
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	</div>
	{#if tags.length}
		<nav class="chips list-tags" aria-label="Tag filter">
			{#each tags.slice(0, 8) as tag (tag.id)}<a class="chip" href={filterHref(page.url, 'tag', String(tag.id), true)} aria-current={selection.tag.includes(tag.id) ? 'true' : undefined}>{tag.name}</a>{/each}
			{#if tags.length > 8}
				<Popover.Root>
					<Popover.Trigger class="chip">+{tags.length - 8} more</Popover.Trigger>
					<Popover.Portal><Popover.Content class="ui-popover list-tag-popup" sideOffset={6} collisionPadding={12}>
						<label class="field">Find tags<input class="input" type="search" bind:value={tagSearch} placeholder="Search tags…" /></label>
						<div class="filter-options">{#each extraTags as tag (tag.id)}<a class="ui-item" href={filterHref(page.url, 'tag', String(tag.id), true)} aria-current={selection.tag.includes(tag.id) ? 'true' : undefined}>{#if selection.tag.includes(tag.id)}<Icon name="check" size={14} />{/if}{tag.name}</a>{:else}<p class="muted">No matching tags</p>{/each}</div>
					</Popover.Content></Popover.Portal>
				</Popover.Root>
			{/if}
		</nav>
	{/if}
</div>
