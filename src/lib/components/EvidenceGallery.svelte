<script lang="ts">
	import Icon from './Icon.svelte';
	type EvidenceItem = { id: string; url: string; filename: string; contentType: string | null; sizeBytes?: number | null; note?: string | null; uploadedBy?: string | null; createdAt?: string | null };
	let { items, emptyText = 'No evidence yet' }: { items: EvidenceItem[]; emptyText?: string } = $props();
	let dialog: HTMLDialogElement;
	let index = $state(0);
	let trigger: HTMLButtonElement | undefined;
	const current = $derived(items[index]);
	const image = (type: string | null) => type === 'image/png' || type === 'image/jpeg';
	function open(i: number, button: HTMLButtonElement) {
		trigger = button;
		index = i;
		dialog.showModal();
	}
	function move(delta: number) { index = (index + delta + items.length) % items.length; }
	function keydown(event: KeyboardEvent) {
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
			event.preventDefault();
			move(event.key === 'ArrowLeft' ? -1 : 1);
		}
	}
</script>

{#if items.length === 0}
	<p class="muted">{emptyText}</p>
{:else}
	<div class="gallery">
		{#each items as item, i (item.id)}
			<button class="gallery__tile" type="button" aria-label="Open {item.filename}" onclick={(event) => open(i, event.currentTarget)}>
				{#if image(item.contentType)}<img src={item.url} loading="lazy" alt={item.filename} />{:else}<Icon name="file" size={28} />{/if}
				<span>{item.filename}</span>
			</button>
		{/each}
	</div>
{/if}
<dialog bind:this={dialog} class="gallery-dialog" onkeydown={keydown} onclose={() => trigger?.focus()} aria-label="Evidence preview">
	{#if current}
		<header class="gallery-dialog__header">
			<div><strong>{current.filename}</strong><p class="muted">{current.sizeBytes != null ? `${(current.sizeBytes / 1024).toFixed(1)} KB · ` : ''}{current.uploadedBy ?? 'Unknown uploader'}{current.createdAt ? ` · ${current.createdAt}` : ''}</p></div>
			<a href="{current.url}?download=1" download>Download</a>
			<button class="btn" type="button" aria-label="Close preview" onclick={() => dialog.close()}>Close</button>
		</header>
		<div class="gallery-dialog__body">
			{#if image(current.contentType)}<img src={current.url} alt={current.filename} />{:else if current.contentType === 'application/pdf'}<iframe src={current.url} title={current.filename}></iframe>{:else}<Icon name="file" size={48} />{/if}
		</div>
		{#if items.length > 1 || current.note}
			<footer class="gallery-dialog__footer">
				{#if items.length > 1}
					<button class="btn" type="button" aria-label="Previous evidence" onclick={() => move(-1)}>Previous</button>
					<span>{index + 1} / {items.length}</span>
					<button class="btn" type="button" aria-label="Next evidence" onclick={() => move(1)}>Next</button>
				{/if}
				{#if current.note}<p>{current.note}</p>{/if}
			</footer>
		{/if}
	{/if}
</dialog>

<style>
	.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; }
	.gallery__tile { min-width: 0; border: 1px solid var(--control-edge); border-radius: 6px; background: var(--surface); padding: 8px; cursor: pointer; color: var(--text); text-align: left; }
	.gallery__tile img { width: 100%; height: 90px; object-fit: cover; border-radius: 4px; }
	.gallery__tile span { display: block; overflow-wrap: anywhere; font-size: 12px; }
	.gallery__tile:focus-visible, .gallery-dialog button:focus-visible, .gallery-dialog a:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
	.gallery-dialog { margin: auto; width: min(96vw, 1200px); height: 92vh; max-width: none; max-height: none; padding: 0; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--text); }
	.gallery-dialog[open] { display: flex; flex-direction: column; }
	.gallery-dialog::backdrop { background: rgb(0 0 0 / 0.72); }
	.gallery-dialog__header, .gallery-dialog__footer { display: flex; align-items: center; flex-wrap: wrap; flex-shrink: 0; gap: 12px; padding: 12px 16px; }
	.gallery-dialog__header > div { flex: 1; min-width: 0; overflow-wrap: anywhere; }
	.gallery-dialog__header p { margin: 0; }
	.gallery-dialog__body { display: grid; place-items: center; flex: 1; min-height: 0; background: var(--surface-2); overflow: hidden; }
	.gallery-dialog__body img { max-width: 100%; max-height: 100%; object-fit: contain; }
	.gallery-dialog__body iframe { width: 100%; height: 100%; border: 0; }
	.gallery-dialog__footer p { width: 100%; margin: 0; overflow-wrap: anywhere; }
	@media (max-width: 639px) { .gallery-dialog { width: 100vw; height: 100dvh; border-radius: 0; } }
</style>
