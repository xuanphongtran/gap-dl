<script setup lang="ts">
import PixelEmptyState from '../../components/base/PixelEmptyState.vue'
</script>

<template>
  <PixelEmptyState as="main" class="empty-room">
    <div class="empty-icon" aria-hidden="true">▣</div>
    <p class="eyebrow">SELECT A CHANNEL</p>
    <h1>Your next conversation starts here</h1>
    <p class="muted">Choose a room from the sidebar, or create one and invite your friends.</p>
  </PixelEmptyState>
</template>
