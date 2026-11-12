<script lang="ts">
	interface Props {
		org: { slug: string; name: string };
		organizations: Array<{ slug: string; name: string }>;
		userName: string;
		csrfToken: string;
		active: string;
	}

	let { org, organizations, userName, csrfToken, active }: Props = $props();
	const others = $derived(organizations.filter((candidate) => candidate.slug !== org.slug));
</script>

<header class="masthead">
	<div class="masthead__org">
		<span class="masthead__org-name">{org.name}</span>
		<span class="muted">{userName}</span>
		{#if others.length > 0}
			<a class="muted" href="/orgs">Switch organization ({others.length} other{#if others.length !== 1}s{/if})</a>
		{:else}
			<a class="muted" href="/orgs">Organizations</a>
		{/if}
	</div>
	<nav class="masthead__nav" aria-label="Organization">
		<a href="/org/{org.slug}/transactions" aria-current={active === 'ledger' ? 'page' : undefined}>Ledger</a>
		<form method="POST" action="/logout">
			<input type="hidden" name="csrf_token" value={csrfToken} />
			<button class="btn btn--quiet" type="submit">Sign out</button>
		</form>
	</nav>
</header>
