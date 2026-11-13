import { downloadDocument, numericPathId, requireOrg } from '$lib/server/txns';
import type { RequestHandler } from './$types';

// Private evidence download. The active-member gate runs first; the row is
// looked up by (id, org_id) together, and viewers without ViewTransactions
// must be income recipients of the tied income transaction. The request-level
// audit hook records the attempt because this shape is an instrumented route.
export const GET: RequestHandler = async (event) => {
	const ctx = await requireOrg(event, event.params.slug);
	return downloadDocument(ctx, numericPathId(event.params.id));
};