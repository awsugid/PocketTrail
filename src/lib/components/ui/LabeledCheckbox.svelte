<script lang="ts">
 import { Checkbox } from './checkbox';
 import { Label } from './label';
 import type { Snippet } from 'svelte';
 import { onFormReset } from '$lib/controls.svelte';
 let { name, value = 'on', checked = $bindable(false), disabled = false, children }: { name: string; value?: string; checked?: boolean; disabled?: boolean; children: Snippet } = $props();
 const id = $props.id();
 const initial = checked;
</script>
<span hidden {@attach onFormReset(() => checked = initial)}></span>
<div class="flex items-center gap-2"><Checkbox {id} {name} {value} {disabled} bind:checked /><Label for={id}>{@render children()}</Label></div>
