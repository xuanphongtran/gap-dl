<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ name?: string | null }>()
const initial = computed(() => props.name?.slice(0, 1).toUpperCase() || '?')
</script>

<template>
  <span class="pixel-avatar" aria-hidden="true">{{ initial }}</span>
</template>
