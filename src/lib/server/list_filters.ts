import { parseRupiah, validDate } from '#lib/fmt.ts';

export type ListStatus = 'needs_details' | 'pending_review' | 'approved' | 'changes_requested';
export const LIST_STATUS_OPTIONS: ReadonlyArray<{value: 'all' | ListStatus | 'needs_action'; label: string}> = [
 {value:'all',label:'All statuses'}, {value:'needs_action',label:'Needs your action'},
 {value:'needs_details',label:'Needs details'}, {value:'pending_review',label:'Pending review'},
 {value:'approved',label:'Approved'}, {value:'changes_requested',label:'Changes requested'}
];
export type ViewerTone = 'action' | 'review' | 'waiting' | 'none';
export interface ListFilters {
 q: string; status: ListStatus | 'needs_action' | null;
 from: string | null; to: string | null; min: number | null; max: number | null;
 dir: 'in' | 'out' | null; kind: 'income' | 'expense' | null;
 tag: number[]; responsible: number[]; actor: number[]; purpose: number[]; page: number;
}
export function parseListFilters(params: URLSearchParams): ListFilters {
 const ids = (key: string) => [...new Set(params.getAll(key).filter(v => /^[1-9]\d*$/.test(v)).map(Number).filter(Number.isSafeInteger))];
 const date = (key: string) => { const v = params.get(key); return v && validDate(v) ? v : null; };
 const amount = (key: string) => { const v = params.get(key); if (!v || !/^\d+(?:\.\d{1,2})?$/.test(v)) return null; return parseRupiah(v); };
 const s = params.get('status');
 const status = s === 'needs_details' || s === 'pending_review' || s === 'approved' || s === 'changes_requested' || s === 'needs_action' ? s : null;
 const p = params.get('page'); const page = p && /^[1-9]\d{0,6}$/.test(p) && Number(p) <= 1_000_000 ? Number(p) : 1;
 const dir = params.get('dir'); const kind = params.get('kind'); const q = params.get('q')?.trim() ?? '';
 let from = date('from'), to = date('to'), min = amount('min'), max = amount('max');
 if (from && to && from > to) { from = null; to = null; }
 if (min !== null && max !== null && min > max) { min = null; max = null; }
 return { q: q.length <= 300 ? q : '', status, from, to, min, max, dir: dir === 'in' || dir === 'out' ? dir : null,
 kind: kind === 'income' || kind === 'expense' ? kind : null, tag: ids('tag'), responsible: ids('responsible'), actor: ids('actor'), purpose: ids('purpose'), page };
}
export function viewerTone(status: ListStatus, responsible: boolean, reviewer: boolean): ViewerTone {
 if (responsible && (status === 'needs_details' || status === 'changes_requested')) return 'action';
 if (status === 'pending_review') return reviewer ? 'review' : 'waiting';
 return 'none';
}
export const intersects = (selected: readonly number[], actual: readonly number[]) => !selected.length || selected.some(id => actual.includes(id));
export function matchesCommon(f: ListFilters, row: { status: ListStatus; tone: ViewerTone; responsibles: { id: number }[] }, amount: number, tags: number[]): boolean {
 return (f.status === null || (f.status === 'needs_action' ? row.tone === 'action' || row.tone === 'review' : row.status === f.status))
 && (f.min === null || amount >= f.min) && (f.max === null || amount <= f.max)
 && intersects(f.responsible, row.responsibles.map(m => m.id)) && intersects(f.tag, tags);
}
export function paginate<T>(rows: T[], requested: number) {
 const total = rows.length, pageCount = Math.max(1, Math.ceil(total / 50)), page = Math.min(requested, pageCount);
 return { entries: rows.slice((page - 1) * 50, page * 50), total, pageCount, page, hasNext: page < pageCount };
}
