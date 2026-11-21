<script lang="ts">
 import { Input } from './input';
 let { id, name, value = $bindable(''), required = false }: { id: string; name: string; value?: string; required?: boolean } = $props();
</script>
<Input oninput={event => { const digits = event.currentTarget.value.replace(/\D/g, '').slice(0, 4); value = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits; event.currentTarget.value = value; }} {id} {name} {required} bind:value inputmode="numeric" autocomplete="off" maxlength={5} placeholder="HH:MM" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" aria-label="24-hour time, HH:MM" />
