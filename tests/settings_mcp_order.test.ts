import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
it('MCP connection guide precedes status list and audit trail',()=>{
 const ui=readFileSync(new URL('../src/routes/org/[slug]/settings/+page.svelte',import.meta.url),'utf8');
 expect(ui.indexOf('id="mcp-heading"')).toBeLessThan(ui.indexOf('aria-label="Settings status"'));
 expect(ui.indexOf('id="mcp-heading"')).toBeLessThan(ui.indexOf('id="audit-heading"'));
 expect(ui).toContain('MCP · AI connections');
});
