<script lang="ts">
 import * as Tooltip from '$lib/components/ui/tooltip';
 import { Textarea } from '$lib/components/ui/textarea';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	// Dual-mode composer: rich text (contenteditable) and Markdown source,
	// sharing one restricted-Markdown document (src/lib/markdown.ts renders,
	// this component serializes back). No-JS baseline: a native textarea under
	// the same name posts the Markdown source; after hydration the rich
	// surface replaces it. Toolbar + Markdown shortcuts + @mention autocomplete.
	import { renderMarkdown } from '$lib/markdown';

	interface Member {
		id: number;
		name: string;
		handle: string;
	}

	interface Props {
		name: string;
		id: string;
		label: string;
		/** Initial Markdown source (server-rendered into the textarea). */
		initial?: string;
		placeholder?: string;
		required?: boolean;
		maxlength?: number;
		members?: Member[];
		rows?: number | string;
		hint?: string;
	}

	let {
		name,
		id,
		label,
		initial = '',
		placeholder = '',
		required = false,
		maxlength = 16000,
		members = [],
		rows = 3,
		hint = ''
	}: Props = $props();

	let textarea = $state<HTMLTextAreaElement>(null!);
	let editor: HTMLDivElement | null = $state(null);
	let mode: 'rich' | 'md' = $state('rich');
	let mounted = $state(false);
	let linkOpen = $state(false);
	let linkUrl = $state('https://');
	let savedRange: Range | null = null;

	interface Tool {
		key: string;
		label: string;
		title: string;
		cls?: string;
	}
	// ponytail: execCommand is deprecated but universally implemented; the
	// upgrade path is a selection-Range based command layer of the same shape.
	const TOOLS: Tool[] = [
		{ key: 'bold', label: 'B', title: 'Bold (**)', cls: 'tool--bold' },
		{ key: 'italic', label: 'I', title: 'Italic (*)', cls: 'tool--italic' },
		{ key: 'h1', label: 'H1', title: 'Heading 1' },
		{ key: 'h2', label: 'H2', title: 'Heading 2' },
		{ key: 'ul', label: 'List', title: 'Bullet list' },
		{ key: 'ol', label: '1.', title: 'Numbered list' },
		{ key: 'quote', label: '❝', title: 'Quote' },
		{ key: 'code', label: '</>', title: 'Code block' },
		{ key: 'link', label: 'Link', title: 'Link' }
	];

	// ------------------------------------------------------------- serialize

	function serializeInline(root: Node): string {
		let out = '';
		for (const node of Array.from(root.childNodes)) {
			if (node.nodeType === Node.TEXT_NODE) {
				out += node.textContent ?? '';
			} else if (node instanceof HTMLElement) {
				const tag = node.tagName;
				if (tag === 'STRONG' || tag === 'B') out += `**${serializeInline(node)}**`;
				else if (tag === 'EM' || tag === 'I') out += `*${serializeInline(node)}*`;
				else if (tag === 'CODE') out += `\`${node.textContent ?? ''}\``;
				else if (tag === 'A') out += `[${serializeInline(node)}](${node.getAttribute('href') ?? ''})`;
				else if (node.classList.contains('mention')) out += `@${node.dataset.handle ?? (node.textContent ?? '').replace(/^@/, '')}`;
				else out += serializeInline(node);
			} else {
				out += node.textContent ?? '';
			}
		}
		return out;
	}

	function serializeBlock(el: Element): string {
		switch (el.tagName) {
			case 'H3':
				return `# ${serializeInline(el)}`;
			case 'H4':
				return `## ${serializeInline(el)}`;
			case 'H5':
				return `### ${serializeInline(el)}`;
			case 'BLOCKQUOTE':
				return `> ${serializeInline(el)}`;
			case 'PRE':
				return `\`\`\`\n${el.textContent ?? ''}\n\`\`\``;
			default:
				return serializeInline(el);
		}
	}

	function serialize(): string {
		if (!editor) return textarea.value;
		// Browsers type straight text nodes into an empty contenteditable before
		// any block exists; treat that as one paragraph.
		if (editor.children.length === 0) return editor.textContent?.trim() ?? '';
		const out: string[] = [];
		for (const el of Array.from(editor.children)) {
			if (el.tagName === 'UL' || el.tagName === 'OL') {
				const items = Array.from(el.children).map(
					(li, i) => `${el.tagName === 'OL' ? `${i + 1}. ` : '- '}${serializeInline(li)}`
				);
				out.push(items.join('\n'));
			} else {
				out.push(serializeBlock(el));
			}
		}
		return out.filter((block) => block.trim() !== '').join('\n\n');
	}

	function syncFromEditor() {
		const value = serialize();
		textarea.value = value;
		textarea.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function renderToEditor(source: string) {
		if (!editor) return;
		editor.innerHTML = renderMarkdown(source);
	}

	// ---------------------------------------------------------------- caret

	function currentBlock(): HTMLElement | null {
		const selection = window.getSelection();
		if (!selection || !selection.rangeCount || !editor) return null;
		let node: Node | null = selection.getRangeAt(0).startContainer;
		while (node && node !== editor) {
			if (node instanceof HTMLElement && node.parentElement === editor) return node;
			node = node.parentNode;
		}
		return null;
	}

	function caretToEnd(el: HTMLElement) {
		const range = document.createRange();
		range.selectNodeContents(el);
		range.collapse(false);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}

	function replaceBlock(block: HTMLElement, tag: string): HTMLElement {
		const next = document.createElement(tag);
		while (block.firstChild) next.appendChild(block.firstChild);
		block.replaceWith(next);
		return next;
	}

	// --------------------------------------------------------------- mention

	let mentionOpen = $state(false);
	let mentionQuery = $state('');
	let mentionIndex = $state(0);
	const mentionMatches = $derived(
		members
			.filter((m) => {
				const q = mentionQuery.toLowerCase();
				return q === '' || m.handle.toLowerCase().startsWith(q) || m.name.toLowerCase().startsWith(q);
			})
			.slice(0, 8)
	);

	function mentionProbe(): { node: Text; start: number } | null {
		const selection = window.getSelection();
		if (!selection || !selection.rangeCount) return null;
		const node = selection.getRangeAt(0).startContainer;
		if (!(node instanceof Text)) return null;
		const offset = selection.getRangeAt(0).startOffset;
		const before = node.textContent?.slice(0, offset) ?? '';
		const match = /(^|[^A-Za-z0-9._-])@([A-Za-z0-9._-]*)$/.exec(before);
		if (!match) return null;
		return { node, start: offset - (match[2] ?? '').length - 1 };
	}

	function mentionUpdate() {
		if (mode !== 'rich' || members.length === 0) {
			mentionOpen = false;
			return;
		}
		const probe = mentionProbe();
		if (probe === null) {
			mentionOpen = false;
			return;
		}
		mentionQuery = (probe.node.textContent ?? '').slice(probe.start + 1, selectionOffset());
		mentionIndex = 0;
		mentionOpen = mentionMatches.length > 0;
	}

	function selectionOffset(): number {
		const selection = window.getSelection();
		if (!selection || !selection.rangeCount) return 0;
		return selection.getRangeAt(0).startOffset;
	}

	function insertMention(member: Member) {
		if (mode === 'md') {
			const start = textarea.selectionStart;
			const before = textarea.value.slice(0, start);
			const at = before.lastIndexOf('@');
			if (at >= 0) {
				const value = `${textarea.value.slice(0, at)}@${member.handle} ${textarea.value.slice(textarea.selectionEnd)}`;
				textarea.value = value;
				textarea.dispatchEvent(new Event('input', { bubbles: true }));
				const caret = at + member.handle.length + 2;
				textarea.focus();
				textarea.setSelectionRange(caret, caret);
			}
		} else if (editor) {
			const probe = mentionProbe();
			if (probe) {
				const selection = window.getSelection();
				const range = document.createRange();
				range.setStart(probe.node, probe.start);
				range.setEnd(probe.node, selectionOffset());
				selection?.removeAllRanges();
				selection?.addRange(range);
				range.deleteContents();
				const chip = document.createElement('span');
				chip.className = 'mention mention--chip';
				chip.dataset.handle = member.handle;
				chip.contentEditable = 'false';
				chip.textContent = `@${member.name}`;
				const space = document.createTextNode(' ');
				range.insertNode(space);
				range.insertNode(chip);
				const after = document.createRange();
				after.setStartAfter(space);
				after.collapse(true);
				selection?.removeAllRanges();
				selection?.addRange(after);
			}
		syncFromEditor();
	}
		mentionOpen = false;
	}

	// ------------------------------------------------------------- shortcuts

	const INLINE_MD = /(\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`)$/;

	function inlineShortcut(): boolean {
		const selection = window.getSelection();
		if (!selection || !selection.rangeCount) return false;
		const node = selection.getRangeAt(0).startContainer;
		if (!(node instanceof Text)) return false;
		const offset = selection.getRangeAt(0).startOffset;
		const before = (node.textContent ?? '').slice(0, offset);
		const match = INLINE_MD.exec(before);
		if (!match) return false;
		const text = match[2] ?? match[3] ?? match[4] ?? '';
		const tag = match[2] !== undefined ? 'strong' : match[3] !== undefined ? 'em' : 'code';
		const range = document.createRange();
		range.setStart(node, offset - match[0].length);
		range.setEnd(node, offset);
		selection.removeAllRanges();
		selection.addRange(range);
		range.deleteContents();
		const element = document.createElement(tag);
		element.textContent = text;
		range.insertNode(element);
		const space = document.createTextNode(' ');
		element.after(space);
		const after = document.createRange();
		after.setStartAfter(space);
		after.collapse(true);
		selection.removeAllRanges();
		selection.addRange(after);
		return true;
	}

	function blockShortcut(): boolean {
		const block = currentBlock();
		if (!block) return false;
		const text = block.textContent ?? '';
		const transforms: Array<[string, string]> = [
			['# ', 'H3'],
			['## ', 'H4'],
			['### ', 'H5'],
			['> ', 'BLOCKQUOTE']
		];
		for (const [prefix, tag] of transforms) {
			if (text.startsWith(prefix)) {
				const rest = text.slice(prefix.length);
				const next = replaceBlock(block, tag);
				next.textContent = rest;
				caretToEnd(next);
				return true;
			}
		}
		return false;
	}

	function onEditorKeydown(event: KeyboardEvent) {
		if (mentionOpen) {
			if (mentionMatches.length === 0) {
				mentionOpen = false;
				return;
			}
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				mentionIndex = (mentionIndex + 1) % mentionMatches.length;
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				mentionIndex = (mentionIndex - 1 + mentionMatches.length) % mentionMatches.length;
				return;
			}
			if (event.key === 'Enter' || event.key === 'Tab') {
				event.preventDefault();
				const member = mentionMatches[mentionIndex];
				if (member) insertMention(member);
				return;
			}
			if (event.key === 'Escape') {
				mentionOpen = false;
				return;
			}
		}
		if (event.key === ' ') {
			if (inlineShortcut()) {
				event.preventDefault();
				syncFromEditor();
				return;
			}
			if (blockShortcut()) {
				event.preventDefault();
				syncFromEditor();
				return;
			}
		}
		if (event.key === 'Enter') {
			// Let the browser split blocks/lists natively.
			queueMicrotask(() => {
				mentionUpdate();
				syncFromEditor();
			});
		}
	}

	function onEditorInput() {
		mentionUpdate();
		syncFromEditor();
	}

	function onEditorPaste(event: ClipboardEvent) {
		// Only our own generated markup ever enters the rich surface.
		event.preventDefault();
		const text = event.clipboardData?.getData('text/plain') ?? '';
		document.execCommand('insertText', false, text);
	}

	// --------------------------------------------------------------- toolbar

	function saveSelection(event: MouseEvent) {
		// Keep the editor selection: the default mousedown would blur it.
		event.preventDefault();
		if (mode === 'rich') {
			const selection = window.getSelection();
			savedRange = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
		} else {
			savedRange = null;
		}
	}

	function restoreSelection() {
		if (mode === 'rich' && savedRange && editor) {
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(savedRange);
			editor.focus();
		} else if (mode === 'md') {
			textarea.focus();
		}
	}

	function applyTool(key: string) {
		if (key === 'link') {
			linkOpen = !linkOpen;
			if (!linkOpen) return;
			linkUrl = 'https://';
			return;
		}
		restoreSelection();
		if (mode === 'md') {
			applyMarkdownTool(key);
		} else if (editor) {
			applyRichTool(key);
			syncFromEditor();
		}
	}

	function applyMarkdownTool(key: string) {
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const selected = textarea.value.slice(start, end) || 'text';
		let next = textarea.value;
		let caret = end;
		switch (key) {
			case 'bold':
				next = `${textarea.value.slice(0, start)}**${selected}**${textarea.value.slice(end)}`;
				caret = start + selected.length + 4;
				break;
			case 'italic':
				next = `${textarea.value.slice(0, start)}*${selected}*${textarea.value.slice(end)}`;
				caret = start + selected.length + 2;
				break;
			case 'h1':
				next = prefixLine(textarea.value, start, '# ');
				break;
			case 'h2':
				next = prefixLine(textarea.value, start, '## ');
				break;
			case 'ul':
				next = prefixLine(textarea.value, start, '- ');
				break;
			case 'ol':
				next = prefixLine(textarea.value, start, '1. ');
				break;
			case 'quote':
				next = prefixLine(textarea.value, start, '> ');
				break;
			case 'code':
				next = `${textarea.value.slice(0, start)}\`\`\`\n${selected}\n\`\`\`${textarea.value.slice(end)}`;
				break;
		}
		textarea.value = next;
		textarea.dispatchEvent(new Event('input', { bubbles: true }));
		textarea.focus();
		textarea.setSelectionRange(caret, caret);
	}

	function prefixLine(value: string, caret: number, prefix: string): string {
		const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
		const lineEnd = value.indexOf('\n', caret);
		const end = lineEnd < 0 ? value.length : lineEnd;
		const line = value.slice(lineStart, end);
		const stripped = line.replace(/^(#{1,3} |- |\d+\. |> )/, '');
		return `${value.slice(0, lineStart)}${prefix}${stripped}${value.slice(end)}`;
	}

	function applyRichTool(key: string) {
		switch (key) {
			case 'bold':
				document.execCommand('bold');
				break;
			case 'italic':
				document.execCommand('italic');
				break;
			case 'h1':
				formatBlock('h3');
				break;
			case 'h2':
				formatBlock('h4');
				break;
			case 'ul':
				document.execCommand('insertUnorderedList');
				break;
			case 'ol':
				document.execCommand('insertOrderedList');
				break;
			case 'quote':
				formatBlock('blockquote');
				break;
			case 'code':
				codeBlock();
				break;
		}
	}

	function formatBlock(tag: string) {
		document.execCommand('formatBlock', false, `<${tag}>`);
	}

	function codeBlock() {
		const block = currentBlock();
		if (!block) return;
		const pre = document.createElement('pre');
		const code = document.createElement('code');
		code.textContent = block.textContent ?? '';
		pre.appendChild(code);
		block.replaceWith(pre);
		caretToEnd(pre);
	}

	function applyLink() {
		const url = linkUrl.trim();
		linkOpen = false;
		if (url === '' || url === 'https://') return;
		if (!/^(https?:\/\/|\/|#)/i.test(url)) return;
		restoreSelection();
		if (mode === 'md') {
			const start = textarea.selectionStart;
			const end = textarea.selectionEnd;
			const selected = textarea.value.slice(start, end) || url;
			textarea.value = `${textarea.value.slice(0, start)}[${selected}](${url})${textarea.value.slice(end)}`;
			textarea.dispatchEvent(new Event('input', { bubbles: true }));
			textarea.focus();
		} else {
			document.execCommand('createLink', false, url);
			syncFromEditor();
		}
	}

	// ------------------------------------------------------------ mode switch

	function switchMode(next: 'rich' | 'md') {
		if (next === mode) return;
		if (next === 'md') {
			textarea.value = serialize();
		} else {
			renderToEditor(textarea.value);
		}
		mode = next;
	}

	// -------------------------------------------------------------- lifecycle

	$effect(() => {
		mounted = true;
		renderToEditor(textarea.value);
		const form = textarea.form;
		const onReset = () => {
			renderToEditor('');
			mentionOpen = false;
		};
		form?.addEventListener('reset', onReset);
		return () => form?.removeEventListener('reset', onReset);
	});
</script>

<div class="composer">
	<div class="composer__bar" role="group" aria-label="Formatting">
		<div class="seg" role="group" aria-label="Editor mode">
			<Button type="button" variant={mode === 'rich' ? 'secondary' : 'ghost'} aria-pressed={mode === 'rich'} onclick={() => switchMode('rich')}>Rich text</Button>
			<Button type="button" variant={mode === 'md' ? 'secondary' : 'ghost'} aria-pressed={mode === 'md'} onclick={() => switchMode('md')}>Markdown</Button>
		</div>
		{#if mounted}
			<div class="composer__tools">
				{#each TOOLS as tool (tool.key)}
					<Tooltip.Provider><Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} type="button" class="tool {tool.cls ?? ''}" aria-label={tool.title} onmousedown={saveSelection} onclick={() => applyTool(tool.key)}>{tool.label}</Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{tool.title}</Tooltip.Content></Tooltip.Root></Tooltip.Provider>
				{/each}
			</div>
		{/if}
	</div>
	{#if linkOpen}
		<div class="composer__link">
			<Label class="visually-hidden" for="{id}-link-url">Link URL</Label>
			<Input class="" id="{id}-link-url" type="url" bind:value={linkUrl} placeholder="https://" />
			<Button type="button" class="" onclick={applyLink} variant="outline" size="sm">Apply link</Button>
			<Button type="button" class="" onclick={() => (linkOpen = false)}>Cancel</Button>
		</div>
	{/if}
	<Label class="visually-hidden" for={id}>{label}</Label>
	<Textarea
		class={`composer__source ${mounted && mode === 'rich' ? 'composer__source--hidden' : ''}`}
		bind:ref={textarea}
		{id}
		{name}
		{placeholder}
		{required}
		{maxlength}
		rows={Number(rows)}
	 value={initial} />
	{#if mounted && mode === 'rich'}
		<div
			class="composer__editor md"
			bind:this={editor}
			role="textbox"
			aria-multiline="true"
			aria-label={label}
			contenteditable="true"
			tabindex="0"
			data-placeholder={placeholder}
			spellcheck="true"
			onkeydown={onEditorKeydown}
			oninput={onEditorInput}
			onpaste={onEditorPaste}
			onblur={() => setTimeout(() => (mentionOpen = false), 150)}
		></div>
	{/if}
	{#if mounted && mode === 'rich' && mentionOpen && mentionMatches.length > 0}
		<div class="composer__mentions" role="listbox" aria-label="Mention a member">
			{#each mentionMatches as member, index (member.id)}
				<Button
					type="button"
					class="composer__mention"
					role="option"
					aria-selected={index === mentionIndex}
					data-active={index === mentionIndex}
					onmousedown={(event) => {
						event.preventDefault();
						insertMention(member);
					}}
				>
					@{member.handle}
					<span class="muted">{member.name}</span>
				</Button>
			{/each}
		</div>
	{/if}
	{#if hint}
		<p class="hint">{hint}</p>
	{/if}
</div>
