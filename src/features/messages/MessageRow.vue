<script setup lang="ts">
import PixelAvatar from '../../components/base/PixelAvatar.vue'
import type { Message } from '../../types'

defineProps<{ message: Message; mine: boolean; time: string }>()
</script>

<template>
  <article class="message-row" :class="{ mine }">
    <PixelAvatar class="message-avatar" :name="message.username" />
    <div class="message-content">
      <div class="message-meta">
        <strong>{{ mine ? 'You' : message.username }}</strong
        ><time :datetime="message.created_at">{{ time }}</time>
      </div>
      <p>{{ message.content }}</p>
    </div>
  </article>
</template>
