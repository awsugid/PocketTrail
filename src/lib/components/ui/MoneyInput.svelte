<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	 import { Input } from './input';

	// IDR amount field. The "Rp" prefix is a visual affordance only: the value
	// posts exactly as typed (whole IDR or `.` decimals), and the server turns it
	// into minor units.
	let { value = $bindable(''), ...rest }: Omit<HTMLInputAttributes, 'type' | 'value' | 'files'> & { value?: string } = $props();
</script>

<span class="money-input">
	<span class="money-input__unit" aria-hidden="true">Rp</span>
	<Input class="pl-9 tabular-nums" inputmode="decimal" autocomplete="off" bind:value {...rest} type="text" />
</span>
