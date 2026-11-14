<script lang="ts">
	import Empty from '$lib/components/Empty.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import { submit } from '$lib/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const base = $derived(`/org/${data.shell.org.slug}/imports`);

	let fileInput: HTMLInputElement | undefined = $state();
	let statementText = $state('');
	let status = $state('');
	let busy = $state(false);
	let extractionFailed = $state(false);

	type PdfModule = {
		GlobalWorkerOptions: { workerSrc: string };
		getDocument(options: { data: ArrayBuffer; password?: string; isEvalSupported: boolean }): { promise: Promise<PdfDocument> };
	};
	interface PdfPage {
		getTextContent(): Promise<{ items: unknown[] }>;
	}
	interface PdfDocument {
		numPages: number;
		getPage(page: number): Promise<PdfPage>;
	}
	type ExtractionApi = { itemsToText(items: unknown[]): string };

	async function loadModule<T>(path: string): Promise<T> {
		return (await import(/* @vite-ignore */ path)) as T;
	}

	async function readFile(file: File): Promise<{ text: string; pages: number }> {
		const lib = await loadModule<PdfModule>('/vendor/pdf.min.mjs');
		lib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
		const helper = (window as unknown as { PocketTrailExtraction?: ExtractionApi }).PocketTrailExtraction;
		if (!helper) throw new Error('the statement text helper did not load');
		const buffer = await file.arrayBuffer();
		let pdf: PdfDocument;
		try {
			pdf = await lib.getDocument({ data: buffer, isEvalSupported: false }).promise;
		} catch (cause) {
			if ((cause as { name?: string } | null)?.name !== 'PasswordException') throw cause;
			const password = window.prompt('This statement PDF is password-protected. Enter its password:');
			if (password === null) throw cause;
			pdf = await lib.getDocument({ data: buffer, password, isEvalSupported: false }).promise;
		}
		const pages: string[] = [];
		for (let page = 1; page <= pdf.numPages; page += 1) {
			const content = await (await pdf.getPage(page)).getTextContent();
			pages.push(helper.itemsToText(content.items));
		}
		return { text: pages.join('\n'), pages: pdf.numPages };
	}

	async function extract() {
		const file = fileInput?.files?.[0];
		if (!file) return;
		busy = true;
		extractionFailed = false;
		statementText = '';
		status = `Extracting ${file.name}…`;
		try {
			const result = await readFile(file);
			statementText = result.text;
			status = `Extracted ${file.name} (${result.pages} page${result.pages === 1 ? '' : 's'}) with preserved rows.`;
		} catch (cause) {
			extractionFailed = true;
			status = `Could not read the file${cause instanceof Error && cause.message ? `: ${cause.message.replace(/[.\s]+$/, '')}` : ''}. Paste the statement text manually instead.`;
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Imports · {data.shell.org.name}</title>
	<script src="/extraction.cjs"></script>
</svelte:head>

<OrgShell {...data.shell} active="imports">
	<PageHead title="Imports" icon="imports" />

	{#if data.msg}<Notice tone="success">{data.msg}</Notice>{/if}

	<div class="stack">
		<section class="panel" aria-labelledby="stage-heading">
			<div class="panel__head"><Icon name="upload" size={16} /><h2 id="stage-heading">Stage a statement</h2></div>
			<div class="panel__body">
				{#if data.pockets.length === 0}
					<Notice tone="warning">Create a pocket in Settings before importing.</Notice>
				{:else}
					<form method="POST" action={base} enctype="multipart/form-data" class="form" use:submit>
						<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
						<div class="form-grid">
							<div class="field">
								<label for="import-pocket">Pocket</label>
								<select class="select" id="import-pocket" name="pocket_id" required>
									{#each data.pockets as pocket (pocket.id)}
										<option value={pocket.id}>{pocket.name}</option>
									{/each}
								</select>
							</div>
							<div class="field">
								<label for="import-file">Original statement PDF</label>
								<input
									class="input"
									id="import-file"
									name="file"
									type="file"
									accept="application/pdf,.pdf"
									required
									bind:this={fileInput}
									onchange={extract}
									aria-describedby="import-status"
								/>
							</div>
						</div>
						<p class="hint" id="import-status" role="status" aria-live="polite">{status}</p>
						<details class="fold" open={extractionFailed}>
							<summary>Extracted text</summary>
							<textarea class="input textarea mono-area" name="statement_text" rows="8" aria-label="Extracted statement text" bind:value={statementText}></textarea>
						</details>
						<div class="form-actions">
							<button class="btn btn--primary" type="submit" disabled={busy || (extractionFailed && statementText.trim() === '')}>
								<Icon name="upload" size={16} />Stage statement
							</button>
						</div>
					</form>
				{/if}
			</div>
		</section>

		<section class="panel" aria-labelledby="batches-heading">
			<div class="panel__head">
				<Icon name="history" size={16} /><h2 id="batches-heading">Recent</h2>
				<span class="count">{data.batches.length}</span>
			</div>
			{#if data.batches.length === 0}
				<Empty icon="imports" title="No imports yet" inline />
			{:else}
				<div class="table-scroll">
					<table class="ledger">
						<caption class="visually-hidden">Statement imports, newest first</caption>
						<thead>
							<tr>
								<th scope="col">Statement</th>
								<th scope="col">Staged</th>
								<th scope="col">Status</th>
								<th scope="col">Result</th>
							</tr>
						</thead>
						<tbody>
							{#each data.batches as batch (batch.id)}
								<tr>
									<td class="row-identity">
										<a href="{base}/{batch.id}">{batch.filename}</a>
										<span class="cell__sub">#{batch.id} · {batch.byName}</span>
									</td>
									<td class="cell--nowrap">{batch.createdAt}</td>
									<td>
										<span class="badge badge--{batch.status === 'committed' ? 'approved' : 'review'}">
											{batch.status === 'committed' ? 'Committed' : 'Awaiting confirmation'}
										</span>
									</td>
									<td>
										{#if Object.keys(batch.counts).length > 0}
											<span class="count">
												{batch.counts.imported ?? 0} new · {batch.counts.duplicate_unchanged ?? 0} unchanged ·
												{batch.counts.conflict ?? 0} conflicts · {batch.counts.needs_review ?? 0} to review
											</span>
										{:else}
											<span class="muted">—</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	</div>
</OrgShell>
