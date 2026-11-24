<script lang="ts">
	import { page } from '$app/state';
	import OrgShell from '#lib/components/OrgShell.svelte';
	import PageHead from '#lib/components/PageHead.svelte';
	import SettingsNav from '#lib/components/SettingsNav.svelte';
	import { fmtMoment } from '#lib/fmt.ts';
	import { stack } from '#lib/table.ts';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let panel = $state<HTMLDialogElement>();
	let mode = $state<'html' | 'text'>('html');
	const base = $derived(`/org/${data.shell.org.slug}/settings/email-history`);
	function href(change: { id?: number; page?: number } = {}) {
		const params = new URLSearchParams(page.url.search);
		params.delete('id');
		if (change.id) params.set('id', String(change.id));
		if (change.page) params.set('page', String(change.page));
		return `${base}${params.size ? `?${params}` : ''}`;
	}
	$effect(() => {
		if (data.preview && panel && !panel.open) panel.showModal();
	});
</script>

<OrgShell {...data.shell} active="settings">
	<PageHead title="Email history" icon="history" />
	<SettingsNav current="email-history" can={data.can} slug={data.shell.org.slug} />
	<form method="GET" action={base} class="filters" aria-label="Filter email history">
		<label>Recipient <input class="input" name="q" type="search" maxlength="200" value={data.filters.q} placeholder="Name or email" /></label>
		<label>Kind <select class="input" name="kind" value={data.filters.kind}><option value="">All kinds</option>{#each data.kinds as { kind } (kind)}<option value={kind}>{kind}</option>{/each}</select></label>
		<label>Status <select class="input" name="status" value={data.filters.status}><option value="">All statuses</option><option value="sent">Sent</option><option value="failed">Failed</option></select></label>
		<label>From <input class="input" type="date" name="from" value={data.filters.from} /></label>
		<label>Through <input class="input" type="date" name="to" value={data.filters.to} /></label>
		<button class="btn" type="submit">Apply filters</button>
		{#if Object.values(data.filters).some(Boolean)}<a href={base}>Clear</a>{/if}
	</form>
	{#if data.rows.length}
		<table class="ledger" use:stack>
			<caption class="sr-only">Email delivery attempts</caption>
			<thead><tr><th scope="col">Sent (Jakarta)</th><th scope="col">To</th><th scope="col">Kind</th><th scope="col">Subject</th><th scope="col">Status</th></tr></thead>
			<tbody>{#each data.rows as row (row.id)}
				<tr><td data-label="Sent">{fmtMoment(row.created_at)}</td>
					<td data-label="To">{row.name ? `${row.name} · ` : ''}{row.to_address}</td>
					<td data-label="Kind" class="kind">{row.kind}</td>
					<td data-label="Subject"><a href={href({ id: row.id })}>{row.subject}</a></td>
					<td data-label="Status"><span class="status" class:failed={row.status === 'failed'}>{row.status === 'sent' ? 'Sent' : 'Failed'}</span></td></tr>
			{/each}</tbody>
		</table>
	{:else}
		<p class="empty">No matching email attempts.</p>
	{/if}
	{#if data.pages > 1}
		<nav class="pagination" aria-label="Email history pages">
			{#if data.page > 1}<a class="btn" href={href({ page: data.page - 1 })}>Previous</a>{/if}
			<span>Page {data.page} of {data.pages}</span>
			{#if data.page < data.pages}<a class="btn" href={href({ page: data.page + 1 })}>Next</a>{/if}
		</nav>
	{/if}
	{#if data.preview}
		{@const email = data.preview}
		<dialog bind:this={panel} aria-labelledby="email-preview-title" oncancel={(event) => { event.preventDefault(); panel?.querySelector('a')?.click(); }}>
			<header><h2 id="email-preview-title">Email preview</h2><a class="btn" href={href()}>Close</a></header>
			<dl>
				<dt>Subject</dt><dd>{email.subject}</dd>
				<dt>To</dt><dd>{email.name ? `${email.name} · ` : ''}{email.to_address}</dd>
				<dt>From</dt><dd>{email.from_address}</dd>
				<dt>Kind</dt><dd class="kind">{email.kind}</dd>
				<dt>Status</dt><dd><span class="status" class:failed={email.status === 'failed'}>{email.status === 'sent' ? 'Sent' : 'Failed'}</span></dd>
				<dt>Attempted</dt><dd>{fmtMoment(email.created_at)} (Jakarta)</dd>
				<dt>Message-ID</dt><dd>{email.message_id ?? '—'}</dd>
				{#if email.error}<dt>Error</dt><dd>{email.error}</dd>{/if}
				{#if email.outbox_ids}<dt>Outbox IDs</dt><dd>{email.outbox_ids}</dd>{/if}
			</dl>
			<div class="modes" role="group" aria-label="Message format">
				<button class="btn" aria-pressed={mode === 'html'} onclick={() => mode = 'html'}>HTML</button>
				<button class="btn" aria-pressed={mode === 'text'} onclick={() => mode = 'text'}>Plain text</button>
			</div>
			{#if mode === 'html' && email.html_body}
				<iframe title="HTML email" sandbox="" srcdoc={email.html_body} referrerpolicy="no-referrer"></iframe>
			{:else if mode === 'html'}<p>No HTML body.</p>
			{:else}<pre>{email.text_body}</pre>{/if}
		</dialog>
	{/if}
</OrgShell>

<style>
	.filters, .pagination, .modes, header { display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; }
	.filters { align-items: end; margin-block: 1rem; }
	.filters label { display: grid; gap: .25rem; font-size: .8125rem; }
	.pagination, .empty { margin-top: 1rem; }
	td, dd { overflow-wrap: anywhere; }
	.kind { text-transform: capitalize; }
	.status { display: inline-block; padding: .125rem .375rem; border-radius: .3125rem; color: var(--success); background: var(--success-bg); font-size: .8125rem; }
	.status.failed { color: var(--danger); background: var(--danger-bg); }
	dialog { position: fixed; inset: 0 0 0 auto; margin: 0; height: 100dvh; max-height: none; width: min(100%, 42rem); max-width: none; padding: 1.25rem; border-left: 1px solid var(--border); background: var(--surface); color: var(--text); }
	dialog::backdrop { background: rgb(24 24 27 / .4); }
	header { justify-content: space-between; }
	dl { margin-block: 1rem; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: .375rem 1rem; }
	dt { color: var(--muted); }
	dd { margin: 0; }
	iframe, pre { display: block; width: 100%; margin-top: .75rem; border: 1px solid var(--border); border-radius: .5rem; background: white; }
	iframe { height: 55dvh; }
	pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: .75rem; }
	button[aria-pressed='true'] { background: var(--primary); color: white; }
</style>
