<script setup lang="ts">
withDefaults(defineProps<{ as?: 'div' | 'main' }>(), { as: 'div' })
</script>

<template>
  <component :is="as" class="pixel-empty-state"><slot /></component>
</template>
