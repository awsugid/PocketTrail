import type { D1Database } from '$lib/d1';
import { effectiveResponsibles, type PurposeKind } from '$lib/purposes';
import { qAll } from './db';
import { needsDetails } from './ledger';
import { labelMatches } from './rows';
import { viewerTone, type ListStatus } from './list_filters';

export interface ListMember { id: number; name: string; picture: string | null }
export interface ListViewer { membershipIds: number[]; reviewer: boolean }
interface TransactionRow {
 id: number; txn_date: string; txn_time: string | null; counterparty: string; bank_id: string | null;
 amount_minor: number; balance_minor: number | null; status: string; explanation: string;
 evidence_unavailable_reason: string; evidence_count: number; responsible_membership_id: number | null;
 pocket_id: number; suppressed: number;
}
interface PurposeRow { id: number; name: string; kind: PurposeKind; status: string; notes: string; evidence_count: number }
interface AllocationRow { purpose_id: number; transaction_id: number; amount_minor: number; responsible_membership_id: number | null }
export interface ListAllocation { purposeId: number; purposeName: string; amountMinor: number; status: ListStatus; responsibles: ListMember[] }
export interface TransactionListEntry {
 id: number; date: string; time: string | null; counterparty: string; bankId: string | null;
 amountMinor: number; balanceMinor: number | null; status: ListStatus; tone: ReturnType<typeof viewerTone>;
 responsibles: ListMember[]; allocations: ListAllocation[]; unallocatedMinor: number;
 suppressed: boolean;
}
export interface PurposeListEntry {
 id: number; name: string; kind: PurposeKind; totalAllocatedMinor: number; status: ListStatus;
 tone: ReturnType<typeof viewerTone>; responsibles: ListMember[];
 transactions: { id: number; date: string; counterparty: string; bankId: string | null; allocatedMinor: number; status: ListStatus }[];
}
export async function readListData(db: D1Database, orgId: number, viewer: ListViewer) {
 // ponytail: loads whole org then filters in memory; fine for small orgs. Move filters/aggregates/pagination into SQL when list loads get slow.
 const [transactions, purposes, allocations, responsibleRows, members, tags, transactionTags, actors] = await Promise.all([
 qAll<TransactionRow>(db, `SELECT t.*, (SELECT COUNT(*) FROM documents d WHERE d.org_id=t.org_id AND d.transaction_id=t.id AND d.kind='evidence' AND d.superseded=0) evidence_count FROM transactions t WHERE t.org_id=?1 ORDER BY t.txn_date DESC, COALESCE(t.txn_time,'') DESC, t.id DESC`, [orgId]),
 qAll<PurposeRow>(db, `SELECT p.*, (SELECT COUNT(*) FROM documents d WHERE d.org_id=p.org_id AND d.purpose_id=p.id AND d.kind='evidence' AND d.superseded=0) evidence_count FROM purposes p WHERE p.org_id=?1 ORDER BY p.kind, lower(p.name), p.id`, [orgId]),
 qAll<AllocationRow>(db, `SELECT a.* FROM allocations a JOIN purposes p ON p.id=a.purpose_id AND p.org_id=a.org_id JOIN transactions t ON t.id=a.transaction_id AND t.org_id=a.org_id WHERE a.org_id=?1 ORDER BY a.id`, [orgId]),
 qAll<{purpose_id: number; membership_id: number}>(db, `SELECT pr.* FROM purpose_responsibles pr JOIN purposes p ON p.id=pr.purpose_id JOIN memberships m ON m.id=pr.membership_id AND m.org_id=p.org_id WHERE p.org_id=?1 ORDER BY pr.membership_id`, [orgId]),
 qAll<ListMember>(db, `SELECT m.id,u.name,u.picture FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=?1 ORDER BY u.name COLLATE NOCASE,m.id`, [orgId]),
 qAll<{id: number; name: string; usageCount: number}>(db, `SELECT g.id,g.name,COUNT(t.id) usageCount FROM tags g LEFT JOIN transaction_tags tt ON tt.tag_id=g.id AND tt.org_id=g.org_id LEFT JOIN transactions t ON t.id=tt.transaction_id AND t.org_id=g.org_id WHERE g.org_id=?1 GROUP BY g.id ORDER BY usageCount DESC,g.name COLLATE NOCASE,g.id`, [orgId]),
 qAll<{transaction_id: number; tag_id: number}>(db, `SELECT tt.transaction_id,tt.tag_id FROM transaction_tags tt JOIN transactions t ON t.id=tt.transaction_id AND t.org_id=tt.org_id WHERE tt.org_id=?1`, [orgId]),
 qAll<{id: number; pattern: string; pocket_id: number; membership_id: number; name: string}>(db, `SELECT a.id,a.pattern,a.pocket_id,a.membership_id,u.name FROM actor_mappings a JOIN memberships m ON m.id=a.membership_id AND m.org_id=a.org_id JOIN users u ON u.id=m.user_id WHERE a.org_id=?1 ORDER BY a.id`, [orgId])
 ]);
 const memberMap = new Map(members.map(m => [m.id,m]));
 const people = (ids: number[]) => [...new Set(ids)].flatMap(id => { const m = memberMap.get(id); return m ? [m] : []; });
 const purposeMap = new Map(purposes.map(p => [p.id,p]));
 const byTxn = new Map<number, AllocationRow[]>(), byPurpose = new Map<number, AllocationRow[]>();
 const purposeMembers = new Map<number, number[]>(), tagIds = new Map<number, number[]>(), actorIds = new Map<number, number[]>();
 for (const r of responsibleRows) purposeMembers.set(r.purpose_id, [...(purposeMembers.get(r.purpose_id) ?? []),r.membership_id]);
 for (const a of allocations) { byTxn.set(a.transaction_id,[...(byTxn.get(a.transaction_id) ?? []),a]); byPurpose.set(a.purpose_id,[...(byPurpose.get(a.purpose_id) ?? []),a]); }
 for (const t of transactionTags) tagIds.set(t.transaction_id,[...(tagIds.get(t.transaction_id) ?? []),t.tag_id]);
 const txnMap = new Map(transactions.map(t => [t.id,t]));
 const responsibleFor = (a: AllocationRow) => effectiveResponsibles(a.responsible_membership_id,purposeMembers.get(a.purpose_id) ?? [],txnMap.get(a.transaction_id)?.responsible_membership_id ?? null);
 const purposeStatus = (p: PurposeRow): ListStatus => p.status === 'approved' || p.status === 'changes_requested' ? p.status : p.status === 'submitted' ? 'pending_review' : 'needs_details';
 const tone = (status: ListStatus, responsibles: ListMember[]) => viewerTone(status,responsibles.some(m => viewer.membershipIds.includes(m.id)),viewer.reviewer);
 const entries: TransactionListEntry[] = transactions.map(t => {
 const assigned = (byTxn.get(t.id) ?? []).map(a => { const p = purposeMap.get(a.purpose_id)!; return { purposeId: p.id,purposeName:p.name,amountMinor:a.amount_minor,status:purposeStatus(p),responsibles:people(responsibleFor(a)) }; });
 const unallocatedMinor = Math.abs(t.amount_minor)-assigned.reduce((s,a) => s+a.amountMinor,0);
 let status: ListStatus;
 if (t.amount_minor < 0) {
 status = unallocatedMinor === 0 && assigned.every(a => a.status === 'approved') ? 'approved' : assigned.some(a => a.status === 'changes_requested') ? 'changes_requested'
 : unallocatedMinor !== 0 || assigned.some(a => a.status === 'needs_details') ? 'needs_details' : 'pending_review';
 } else status = t.status === 'approved' || t.status === 'changes_requested' ? t.status : needsDetails(t.amount_minor,t.explanation,t.evidence_count,t.evidence_unavailable_reason,t.status) ? 'needs_details' : 'pending_review';
 const transactionResponsibles = people(t.responsible_membership_id === null ? [] : [t.responsible_membership_id]);
 const units = t.amount_minor < 0 ? [...assigned,...(unallocatedMinor !== 0 || !assigned.length ? [{status:'needs_details' as const,responsibles:transactionResponsibles}] : [])] : [{status,responsibles:transactionResponsibles}];
 const responsibles = people(units.flatMap(a => a.responsibles.map(m => m.id)));
 const tones = units.map(a => tone(a.status,a.responsibles));
 const rowTone = (['action','review','waiting','none'] as const).find(value => tones.includes(value)) ?? 'none';
 const matches = actors.filter(a => a.pocket_id === t.pocket_id && labelMatches(a.pattern,t.counterparty));
 const exact = matches.find(a => a.pattern.trim().toLowerCase() === t.counterparty.trim().toLowerCase());
 actorIds.set(t.id,(exact ? [exact] : matches.slice(0,1)).map(a => a.id));
 return {suppressed:!!t.suppressed,id:t.id,date:t.txn_date,time:t.txn_time,counterparty:t.counterparty,bankId:t.bank_id,amountMinor:t.amount_minor,balanceMinor:t.balance_minor,status,tone:rowTone,responsibles,allocations:assigned,unallocatedMinor};
 });
 const entryMap = new Map(entries.map(t => [t.id,t]));
 const purposeEntries: PurposeListEntry[] = purposes.map(p => {
 const allocated = byPurpose.get(p.id) ?? [];
 const responsibles = people(allocated.length ? allocated.flatMap(responsibleFor) : purposeMembers.get(p.id) ?? []);
 const status = purposeStatus(p);
 return {id:p.id,name:p.name,kind:p.kind,totalAllocatedMinor:allocated.reduce((s,a) => s+a.amount_minor,0),status,tone:tone(status,responsibles),responsibles,
 transactions:allocated.map(a => { const t = entryMap.get(a.transaction_id)!; return {id:t.id,date:t.date,counterparty:t.counterparty,bankId:t.bankId,allocatedMinor:a.amount_minor,status:t.status}; }).sort((a,b) => b.date.localeCompare(a.date) || b.id-a.id)};
 });
 return {entries,purposeEntries,tagIds,actorIds,filterOptions:{tags,members,actors:actors.map(a => ({id:a.id,name:a.name,pattern:a.pattern,pocketId:a.pocket_id,membershipId:a.membership_id})),purposes:purposes.map(p => ({id:p.id,name:p.name}))}};
}
