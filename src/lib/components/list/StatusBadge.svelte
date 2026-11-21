<script lang="ts">
	import Icon, { type IconName } from '../Icon.svelte';
	 import { Badge } from '$lib/components/ui/badge';
	import { statuses, type Status } from './helpers';
	let { status }: { status: Status } = $props();
	const styles: Record<Status, { tone: string; icon: IconName }> = {
		needs_details: { tone: 'needs', icon: 'alert' }, pending_review: { tone: 'review', icon: 'history' },
		approved: { tone: 'approved', icon: 'check' }, changes_requested: { tone: 'changes', icon: 'close' }
	};
</script>

<Badge variant="outline" class="badge--{styles[status].tone}"><Icon name={styles[status].icon} size={12} />{statuses.find(option => option.value === status)?.label}</Badge>
