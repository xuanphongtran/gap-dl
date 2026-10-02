<script setup lang="ts">
import AuthScreen from '../features/auth/AuthScreen.vue'

defineProps<{ mode: 'login' | 'register' }>()
</script>

<template>
  <AuthScreen :mode="mode" />
</template>
