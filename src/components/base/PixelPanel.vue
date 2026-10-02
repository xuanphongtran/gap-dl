<script setup lang="ts">
withDefaults(defineProps<{ as?: 'div' | 'section' | 'form' }>(), { as: 'div' })
</script>

<template>
  <component :is="as" class="pixel-panel"><slot /></component>
</template>
