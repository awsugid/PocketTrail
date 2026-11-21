import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

it('AI clients owns connection setup and grants; overview links to it', () => {
	const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
	const ui = read('../src/routes/org/[slug]/settings/ai-clients/+page.svelte');
	expect(ui.indexOf('id="connect-heading"')).toBeLessThan(ui.indexOf('id="clients-heading"'));
	expect(ui).toContain('claude mcp add --transport http pockettrail');
	expect(ui).toContain('context_servers');
	const overview = read('../src/routes/org/[slug]/settings/+page.svelte');
	expect(overview).toContain("title: 'AI clients'");
	expect(overview).not.toContain('grant_id');
});
