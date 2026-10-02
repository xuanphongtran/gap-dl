<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'info' | 'error' }>(), { tone: 'info' })
</script>

<template>
  <p
    class="alert"
    :class="{ error: tone === 'error' }"
    :role="tone === 'error' ? 'alert' : 'status'"
  >
    <slot />
  </p>
</template>
