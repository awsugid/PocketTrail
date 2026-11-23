<script lang="ts">
	import type { Snippet } from 'svelte';
	import MarkdownView from './MarkdownView.svelte';
	import { fmtDate } from '#lib/fmt.ts';
	import { tick } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from './Icon.svelte';

	type Message = { id: number; author: string | number; authorName: string; createdAt: string; mine: boolean; body: string };
	let { open, openHref, closeHref, messages, composer, members }:  { open: boolean; openHref: string; closeHref: string; messages: Message[]; composer: Snippet; members: readonly { handle: string; name: string }[] } = $props();
	const mentionNames = $derived(new Map(members.map(member => [member.handle.toLowerCase(), member.name])));
	let viewport = $state<HTMLDivElement>();
	const day = (m: Message) => m.createdAt.slice(0, 10);
	const time = (m: Message) => m.createdAt.slice(11, 16);
	const minute = (m: Message) => Number(time(m).slice(0, 2)) * 60 + Number(time(m).slice(3));
	const grouped = (m: Message, prev?: Message) => prev && day(m) === day(prev) && m.author === prev.author && Math.abs(minute(m) - minute(prev)) <= 5;
	const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('');
	$effect(() => {
		messages.length;
		if (viewport) viewport.scrollTop = viewport.scrollHeight;
	});
	let panel = $state<HTMLDialogElement>();
	let trigger: HTMLAnchorElement;
	let posting = false;
	beforeNavigate(({ to, cancel }) => {
		if (!posting) return;
		posting = false;
		if (!to || to.url.pathname !== page.url.pathname) return;
		const url = new URL(to.url);
		for (const [key, value] of page.url.searchParams) {
			if (!url.searchParams.has(key) && key !== 'tab') url.searchParams.set(key, value);
		}
		url.searchParams.set('chat', '1');
		const tab = page.url.searchParams.get('tab');
		if (tab && tab !== 'discussion') url.searchParams.set('tab', tab);
		cancel();
		void goto(url, { refreshAll: true, reset: false });
	});
	function closeDiscussion() {
		void goto(closeHref, { replace: true, reset: false });
	}
	$effect(() => {
		const dialog = panel;
		if (!dialog) return;
		// SSR renders an open, non-modal dialog so the link works without JS.
		dialog.removeAttribute('open');
		dialog.showModal();
		const backdrop = (event: MouseEvent) => {
			if (event.target !== dialog) return;
			const { left, right, top, bottom } = dialog.getBoundingClientRect();
			if (event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom) closeDiscussion();
		};
		const failed = () => { posting = false; };
		dialog.addEventListener('click', backdrop);
		dialog.addEventListener('formerror', failed);
		return () => {
			dialog.removeEventListener('click', backdrop);
			dialog.removeEventListener('formerror', failed);
			dialog.close();
			void tick().then(() => { if (!open) trigger?.focus({ preventScroll: true }); });
		};
	});
</script>

<a class="discussion-fab bg-primary shadow-lg" hidden={open} href={openHref} bind:this={trigger} data-discussion-trigger
	data-sveltekit-reset="false" aria-label="Open discussion, {messages.length} messages" aria-expanded={open} aria-haspopup="dialog" title="Discussion">
	<Icon name="comment" size={24} />
	{#if messages.length > 0}<span class="discussion-count" aria-hidden="true">{messages.length > 99 ? '99+' : messages.length}</span>{/if}
</a>

{#if open}
<dialog open class="discussion-panel" aria-labelledby="discussion-heading" bind:this={panel} onsubmit={() => posting = true} oncancel={(event) => { event.preventDefault(); closeDiscussion(); }}>
	<header><Icon name="comment" size={16} /><h2 id="discussion-heading">Discussion ({messages.length})</h2><a class="btn" href={closeHref} aria-label="Close discussion" onclick={(event) => {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		closeDiscussion();
	}}><Icon name="close" size={16} /></a></header>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex (scroll region needs keyboard access) -->
	<div class="messages" tabindex="0" role="region" aria-label="Discussion messages" bind:this={viewport}>
			{#if messages.length}
				<ol>
					{#each messages as message, index (message.id)}
						{@const prev = messages[index - 1]}
						{@const joined = grouped(message, prev)}
						{#if !prev || day(prev) !== day(message)}
							<li class="day">{fmtDate(day(message))}</li>
						{/if}
						<li class="message" class:mine={message.mine} class:joined>
							{#if !message.mine && !joined}<span class="initials" aria-hidden="true">{initials(message.authorName)}</span>{/if}
							<div class="bubble-wrap">
								{#if !joined}<p class="byline"><strong>{message.mine ? 'You' : message.authorName}</strong> · {time(message)}</p>{/if}
								<div class="bubble"><MarkdownView source={message.body} {mentionNames} /></div>
							</div>
						</li>
					{/each}
				</ol>
			{:else}
				<p class="empty"><Icon name="comment" size={20} />No messages yet. Start the discussion.</p>
			{/if}
		</div>
	<div class="composer">{@render composer()}</div>
</dialog>
{/if}

<style>
	.discussion-fab { position: fixed; right: 24px; bottom: calc(24px + env(safe-area-inset-bottom)); z-index: 10; width: 56px; height: 56px; border-radius: 50%; color: var(--primary-foreground); }
	.discussion-fab:not([hidden]) { display: grid; place-items: center; }
	.discussion-fab:hover { background: color-mix(in srgb, var(--primary) 90%, black); }
	.discussion-fab:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
	.discussion-count { position: absolute; top: 0; right: 0; min-width: 18px; padding-inline: 4px; border-radius: var(--radius-badge); background: var(--danger); color: var(--surface); box-shadow: 0 0 0 2px var(--background); font-size: 11px; font-weight: 650; line-height: 18px; text-align: center; }
	@media (width < 640px) { .discussion-fab { right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); } }

	.discussion-panel { position: fixed; inset: 0 0 auto auto; z-index: 100; margin: 0 0 0 auto; width: 400px; max-width: none; height: 100dvh; max-height: none; background: var(--surface); color: var(--text); box-shadow: -12px 0 32px rgb(0 0 0 / 0.16); overflow: hidden; container-type: size; padding-bottom: env(safe-area-inset-bottom); }
	.discussion-panel[open] { display: flex; flex-direction: column; }
	.discussion-panel::backdrop { background: rgb(0 0 0 / 0.4); }
	@media (width < 640px) { .discussion-panel { width: 100vw; } }
	@media (prefers-reduced-motion: no-preference) {
		.discussion-panel:modal { animation: discussion-enter 200ms ease-out; }
		@keyframes discussion-enter { from { transform: translateX(100%); } }
	}
	header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border); flex: none; }
	h2 { font-size: 16px; font-weight: 650; flex: 1; }
	.messages { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; overflow-wrap: anywhere; }
	.messages ol { padding: 0; margin: 0; list-style: none; }
	.day { display: flex; align-items: center; gap: 8px; margin: 12px 0; color: var(--muted); font-size: 12px; }
	.day:first-child { margin-top: 0; }
	.day::before, .day::after { content: ''; flex: 1; border-top: 1px solid var(--border); }
	.message { position: relative; display: flex; padding-left: 36px; margin-top: 10px; }
	.mine { justify-content: end; padding-left: 0; }
	.joined { margin-top: 4px; }
	.initials { position: absolute; left: 0; top: 0; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--surface-2); font-size: 12px; font-weight: 650; }
	.bubble-wrap { max-width: 85%; min-width: 0; }
	.byline { margin: 0 0 2px; color: var(--muted); font-size: 12px; }
	.mine .byline { text-align: right; }
	.bubble { padding: 6px 10px; border-radius: var(--radius-panel); background: var(--surface-2); }
	.mine .bubble { background: color-mix(in srgb, var(--primary) 9%, var(--surface)); }
	.bubble :global(.md > *) { margin-block: 0 4px; }
	.bubble :global(.md > :last-child) { margin-bottom: 0; }
	.empty { display: grid; justify-items: center; gap: 6px; margin: 16px 0; color: var(--muted); text-align: center; }
	.composer { flex: none; padding: 10px 12px; border-top: 1px solid var(--border); }
	.composer :global(form) { margin: 0; padding: 0; border: 0; max-width: none; }
</style>
