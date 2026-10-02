<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'default' | 'primary' | 'danger'
    type?: 'button' | 'submit' | 'reset'
    full?: boolean
    disabled?: boolean
    loading?: boolean
  }>(),
  { variant: 'default', type: 'button' },
)
</script>

<template>
  <button
    class="pixel-button"
    :class="[variant === 'default' ? '' : variant, { full }]"
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <slot />
  </button>
</template>
