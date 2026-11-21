<script lang="ts">
 import { page as current } from '$app/state';
 import * as Pagination from '$lib/components/ui/pagination';
 import { Button } from '$lib/components/ui/button';
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
<div class="my-4 flex flex-wrap items-center justify-between gap-3">
 <span class="count">{total} total · Page {page} of {pageCount}</span>
 <Pagination.Root count={pageCount} perPage={1} {page} aria-label={label} class="mx-0 w-auto">
  <Pagination.Content>
   {#each [{ text: '«', label: 'First page', target: 1, disabled: page === 1 }, { text: '‹', label: 'Previous page', target: page - 1, disabled: page === 1 }] as item}<Pagination.Item><Button variant="ghost" size="icon" href={href(item.target)} disabled={item.disabled} aria-label={item.label}>{item.text}</Button></Pagination.Item>{/each}
   {#each numbers as number, index (index)}<Pagination.Item>{#if number === 'ellipsis'}<Pagination.Ellipsis />{:else}<Button variant={number === page ? 'outline' : 'ghost'} size="icon" href={href(number)} aria-label={`Page ${number}`} aria-current={number === page ? 'page' : undefined}>{number}</Button>{/if}</Pagination.Item>{/each}
   {#each [{ text: '›', label: 'Next page', target: page + 1, disabled: page === pageCount }, { text: '»', label: 'Last page', target: pageCount, disabled: page === pageCount }] as item}<Pagination.Item><Button variant="ghost" size="icon" href={href(item.target)} disabled={item.disabled} aria-label={item.label}>{item.text}</Button></Pagination.Item>{/each}
  </Pagination.Content>
 </Pagination.Root>
</div>
