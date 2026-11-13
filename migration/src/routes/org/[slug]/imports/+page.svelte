<script lang="ts">
	import OrgShell from '$lib/components/OrgShell.svelte';
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
			status = `Could not read the file${cause instanceof Error && cause.message ? `: ${cause.message}` : ''}. Paste the statement text manually instead.`;
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
	<div class="page-head">
		<div>
			<h1>Import statements</h1>
			<p class="lede">
				Choose a pocket and a Jago PDF, check the extracted entries, then confirm the preview. Nothing is
				recorded until you confirm.
			</p>
		</div>
	</div>

	{#if data.msg}<p class="notice" role="status">{data.msg}</p>{/if}

	<section class="detail-section" aria-labelledby="stage-heading">
		<h2 id="stage-heading">Stage a statement</h2>
		<p class="muted">
			Text is extracted in your browser. The extracted text and the original PDF go only to PocketTrail, never
			to a third party, and the original is retained privately.
		</p>
		<p class="muted">
			Transactions are matched by complete Jago transaction ID within the pocket. Unchanged records keep their
			explanations, evidence, discussion, assignments, and approvals. Conflicting bank fields or missing IDs
			are listed for review, never silently replaced.
		</p>

		{#if data.pockets.length === 0}
			<p class="notice notice--danger">
				This organization has no pocket yet. Create a pocket in Settings before importing a statement.
			</p>
		{:else}
			<form method="POST" action={base} enctype="multipart/form-data" class="stack-form">
				<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
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
						bind:this={fileInput}
						onchange={extract}
						aria-describedby="import-status import-text-hint"
					/>
					<p class="hint" id="import-status" role="status" aria-live="polite">{status}</p>
				</div>
				<details class="text-fold">
					<summary>Extracted statement text</summary>
					<p class="hint" id="import-text-hint">
						Filled automatically from the PDF. If extraction fails, paste the statement text here instead;
						the row layout must keep its column spacing.
					</p>
					<textarea class="input textarea" name="statement_text" rows="8" bind:value={statementText}
					></textarea>
				</details>
				<button class="btn btn--primary" type="submit" disabled={busy || extractionFailed}
					>Stage statement</button
				>
			</form>
		{/if}
	</section>

	<section class="detail-section" aria-labelledby="batches-heading">
		<h2 id="batches-heading">Recent imports</h2>
		{#if data.batches.length === 0}
			<div class="empty-state">
				<p>No statements have been imported for this organization yet.</p>
				<p class="muted">Stage one above to see its rows before anything is recorded.</p>
			</div>
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
									<span class="cell__sub">Batch #{batch.id} · by {batch.byName}</span>
								</td>
								<td class="cell--nowrap" data-label="Staged">{batch.createdAt}</td>
								<td data-label="Status">
									<span class="badge badge--{batch.status === 'committed' ? 'approved' : 'review'}">
										{batch.status === 'committed' ? 'Committed' : 'Awaiting confirmation'}
									</span>
								</td>
								<td data-label="Result">
									{#if Object.keys(batch.counts).length > 0}
										{batch.counts.imported ?? 0} imported · {batch.counts.duplicate_unchanged ?? 0} unchanged ·
										{batch.counts.conflict ?? 0} conflicts · {batch.counts.needs_review ?? 0} need review
									{:else}
										<span class="muted">Not classified yet</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</OrgShell>

<style>
	.stack-form {
		display: flex;
		flex-direction: column;
		gap: 16px;
		max-width: 640px;
		margin-top: 12px;
	}
	.text-fold summary {
		cursor: pointer;
		font-weight: 550;
	}
	.textarea {
		width: 100%;
		min-height: 140px;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 12px;
		white-space: pre;
	}
	.hint {
		margin: 4px 0 0;
		font-size: 12px;
		color: var(--text-secondary);
	}
</style>
