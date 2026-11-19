import { describe, expect, it } from 'vitest';
import { markdownToPlain, renderMarkdown } from '../src/lib/markdown';

describe('renderMarkdown blocks', () => {
	it('renders paragraphs with hard line breaks', () => {
		expect(renderMarkdown('one\ntwo')).toBe('<p>one<br>two</p>');
	});

	it('renders headings 1-3 as h3-h5', () => {
		expect(renderMarkdown('# Title')).toBe('<h3>Title</h3>');
		expect(renderMarkdown('## Sub')).toBe('<h4>Sub</h4>');
		expect(renderMarkdown('### Smaller')).toBe('<h5>Smaller</h5>');
	});

	it('renders lists and quotes', () => {
		expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
		expect(renderMarkdown('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
		expect(renderMarkdown('> cited')).toBe('<blockquote><p>cited</p></blockquote>');
	});

	it('renders fenced code blocks without inline formatting', () => {
		expect(renderMarkdown('```\n**not bold**\n```')).toBe('<pre><code>**not bold**</code></pre>');
	});
});

describe('renderMarkdown inline', () => {
	it('renders bold, italic, and code', () => {
		expect(renderMarkdown('**b** and *i* and `c`')).toBe('<p><strong>b</strong> and <em>i</em> and <code>c</code></p>');
	});

	it('renders safe links and keeps unsafe ones as text', () => {
		expect(renderMarkdown('[site](https://example.test)')).toContain('href="https://example.test"');
		expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('href=');
		expect(renderMarkdown('[x](javascript:alert(1))')).toContain('[x]');
		expect(renderMarkdown('[rel](/org/x/purposes/1)')).toContain('href="/org/x/purposes/1"');
	});

	it('rejects protocol-relative and malformed URLs', () => {
		const evil = renderMarkdown('[x](//evil.example)');
		expect(evil).not.toContain('href="//evil');
		expect(evil).toContain('[x](//evil.example)');
		expect(renderMarkdown('[x](\\/\\/evil.example)')).not.toContain('href=');
	});

	it('highlights @mentions', () => {
		expect(renderMarkdown('ping @alice now')).toContain('<span class="mention">@alice</span>');
		expect(renderMarkdown('email@example.test')).not.toContain('mention');
	});
});

describe('renderMarkdown safety', () => {
	it('escapes all raw HTML', () => {
		const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror=1> a & b < c');
		expect(html).not.toContain('<script');
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('&amp;');
	});

	it('escapes HTML inside links and code', () => {
		expect(renderMarkdown('`<b>`')).toContain('<code>&lt;b&gt;</code>');
		const link = renderMarkdown('[<b>](https://x.test)');
		expect(link).not.toContain('<b>');
	});

	it('renders empty input to empty output', () => {
		expect(renderMarkdown('')).toBe('');
		expect(renderMarkdown('  \n ')).toBe('');
	});
});

describe('markdownToPlain', () => {
	it('strips markup for excerpts', () => {
		expect(markdownToPlain('**bold** and [link](https://x) `code`')).toBe('bold and link code');
		const long = 'x'.repeat(300);
		expect(markdownToPlain(long, 50).endsWith('…')).toBe(true);
	});
});
