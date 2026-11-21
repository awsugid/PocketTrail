<script lang="ts">
	import { page as current } from '$app/state';
	import { pageNumbers } from './helpers';
	let { page, pageCount, total, label }: { page: number; pageCount: number; total: number; label: string } = $props();
	const numbers = $derived(pageNumbers(page, pageCount));
	function href(target: number) {
		const params = new URLSearchParams(current.url.search);
		params.delete('page');
		if (target > 1) params.set('page', String(target));
		return `${current.url.pathname}${params.size ? `?${params}` : ''}`;
	}
</script>

<nav class="list-pagination" aria-label={label}>
	<span class="count">{total} total · Page {page} of {pageCount}</span>
	<div class="chips">
		{#each [{ text: '«', label: 'First page', target: 1, disabled: page === 1 }, { text: '‹', label: 'Previous page', target: page - 1, disabled: page === 1 }] as item}
			{#if item.disabled}<span class="chip" aria-disabled="true">{item.text}</span>{:else}<a class="chip" href={href(item.target)} aria-label={item.label}>{item.text}</a>{/if}
		{/each}
		{#each numbers as number, index (index)}
			{#if number === 'ellipsis'}<span class="muted">…</span>{:else}<a class="chip" href={href(number)} aria-label={`Page ${number}`} aria-current={number === page ? 'page' : undefined}>{number}</a>{/if}
		{/each}
		{#each [{ text: '›', label: 'Next page', target: page + 1, disabled: page === pageCount }, { text: '»', label: 'Last page', target: pageCount, disabled: page === pageCount }] as item}
			{#if item.disabled}<span class="chip" aria-disabled="true">{item.text}</span>{:else}<a class="chip" href={href(item.target)} aria-label={item.label}>{item.text}</a>{/if}
		{/each}
	</div>
</nav>
