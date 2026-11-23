// Restricted Markdown renderer for member-authored text (discussion
// messages, purpose Notes). Safe by construction: every input character is
// HTML-escaped before any tag is generated, raw HTML is never passed through,
// and link URLs must be http(s) or app-relative. Supported: paragraphs,
// headings 1-3, bold, italic, unordered/ordered lists, blockquotes, inline
// code, fenced code blocks, links, and @mention highlighting.

import { membershipMentionPattern } from '#lib/mentions.ts';

const mentionPattern = new RegExp(`(^|[^A-Za-z0-9._-])@(${membershipMentionPattern}|[A-Za-z0-9][A-Za-z0-9._-]*)`, 'gi');

const escapeHtml = (text: string): string =>
	text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const SAFE_LINK = /^(https?:\/\/[^\s<>"]+|\/(?!\/)[^\s<>"]*|#[^\s<>"]*)$/i;

/** Inline rendering over already-escaped text. */
function renderInline(escaped: string, names?: ReadonlyMap<string, string>): string {
	let out = '';
	// Code spans first: their content is literal.
	let rest = escaped;
	let code;
	while ((code = /`([^`\n]+)`/.exec(rest)) !== null) {
		out += decorate(rest.slice(0, code.index), names);
		out += `<code>${code[1]}</code>`;
		rest = rest.slice(code.index + code[0].length);
	}
	out += decorate(rest, names);
	return out;
}

function decorate(escaped: string, names?: ReadonlyMap<string, string>): string {
	let text = escaped;
	// Links: [label](url). Unsafe URLs render as the literal escaped text.
	text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, label: string, url: string) => {
		const href = url.replace(/&amp;/g, '&');
		if (!SAFE_LINK.test(href)) return whole;
		return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${label}</a>`;
	});
	text = text.replace(/\*\*([^*\n][^*]*?)\*\*/g, '<strong>$1</strong>');
	text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
	// Match text only, not attributes in generated links.
	text = text.split(/(<[^>]+>)/g).map((part, index) => index % 2 ? part :
		part.replace(mentionPattern, (whole, prefix: string, handle: string) => {
			const name = names?.get(handle.toLowerCase());
			const byId = handle.startsWith('{');
			if (byId && name === undefined) return whole;
			const attr = byId ? ` data-handle="${escapeHtml(handle)}"` : '';
			return `${prefix}<span class="mention"${attr}>@${escapeHtml(name ?? handle)}</span>`;
		})
	).join('');
	return text;
}

type Block =
	| { type: 'paragraph'; lines: string[] }
	| { type: 'heading'; level: number; text: string }
	| { type: 'quote'; lines: string[] }
	| { type: 'list'; ordered: boolean; items: string[] }
	| { type: 'code'; lines: string[] };

const HEADING = /^(#{1,3})\s+(.*)$/;
const UL_ITEM = /^[-*+]\s+(.*)$/;
const OL_ITEM = /^[0-9]{1,9}[.)]\s+(.*)$/;

function parseBlocks(source: string): Block[] {
	const blocks: Block[] = [];
	const lines = source.replace(/\r\n?/g, '\n').split('\n');
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!;
		if (line.trim() === '') {
			i += 1;
			continue;
		}
		if (line.startsWith('```')) {
			const body: string[] = [];
			i += 1;
			while (i < lines.length && !lines[i]!.startsWith('```')) {
				body.push(lines[i]!);
				i += 1;
			}
			i += 1; // closing fence (or end of input)
			blocks.push({ type: 'code', lines: body });
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading) {
			blocks.push({ type: 'heading', level: heading[1]!.length, text: heading[2]! });
			i += 1;
			continue;
		}
		if (/^>\s?/.test(line)) {
			const body: string[] = [];
			while (i < lines.length && /^>\s?/.test(lines[i]!)) {
				body.push(lines[i]!.replace(/^>\s?/, ''));
				i += 1;
			}
			blocks.push({ type: 'quote', lines: body });
			continue;
		}
		const ul = UL_ITEM.exec(line);
		const ol = OL_ITEM.exec(line);
		if (ul || ol) {
			const ordered = ol !== null;
			const items: string[] = [];
			while (i < lines.length) {
				const candidate = lines[i]!;
				const item = ordered ? OL_ITEM.exec(candidate) : UL_ITEM.exec(candidate);
				const other = ordered ? UL_ITEM.exec(candidate) : OL_ITEM.exec(candidate);
				if (item && !other) {
					items.push(item[1]!);
					i += 1;
				} else if (candidate.trim() === '' && i + 1 < lines.length && (ordered ? OL_ITEM : UL_ITEM).test(lines[i + 1]!)) {
					i += 1; // blank line inside a list
				} else {
					break;
				}
			}
			blocks.push({ type: 'list', ordered, items });
			continue;
		}
		const paragraph: string[] = [line];
		i += 1;
		while (i < lines.length && lines[i]!.trim() !== '' && !HEADING.test(lines[i]!) && !lines[i]!.startsWith('```') && !/^>\s?/.test(lines[i]!) && !UL_ITEM.test(lines[i]!) && !OL_ITEM.test(lines[i]!)) {
			paragraph.push(lines[i]!);
			i += 1;
		}
		blocks.push({ type: 'paragraph', lines: paragraph });
	}
	return blocks;
}

/** Renders restricted Markdown to safe HTML. Never throws. */
export function renderMarkdown(source: string, names?: ReadonlyMap<string, string>): string {
	const inline = (text: string) => renderInline(escapeHtml(text), names);
	if (source.trim() === '') return '';
	const blocks = parseBlocks(source);
	const out: string[] = [];
	for (const block of blocks) {
		switch (block.type) {
			case 'code':
				out.push(`<pre><code>${escapeHtml(block.lines.join('\n'))}</code></pre>`);
				break;
			case 'heading': {
				const tag = `h${block.level + 2}`; // # → h3 inside app content
				out.push(`<${tag}>${inline(block.text.trim())}</${tag}>`);
				break;
			}
			case 'quote':
				out.push(`<blockquote><p>${inline(block.lines.join(' ').trim())}</p></blockquote>`);
				break;
			case 'list': {
				const tag = block.ordered ? 'ol' : 'ul';
				const items = block.items.map((item) => `<li>${inline(item.trim())}</li>`).join('');
				out.push(`<${tag}>${items}</${tag}>`);
				break;
			}
			case 'paragraph':
				out.push(`<p>${inline(block.lines.join('\n').trim()).replace(/\n/g, '<br>')}</p>`);
				break;
		}
	}
	return out.join('');
}

/** Plain-text form for excerpts and notifications: no markup survives. */
export function markdownToPlain(source: string, maxLength = 200): string {
	const text = source
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/[*_>#]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}
