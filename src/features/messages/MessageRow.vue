<script setup lang="ts">
import PixelAvatar from '../../components/base/PixelAvatar.vue'
import type { Message } from '../../types'

defineProps<{ message: Message; mine: boolean; time: string }>()
</script>

<template>
  <article class="message-row" :class="{ mine }">
    <PixelAvatar
      class="message-avatar"
      :name="message.user_id === null ? 'Deleted user' : message.username"
    />
    <div class="message-content">
      <div class="message-meta">
        <strong>{{
          message.user_id === null ? 'Deleted user' : mine ? 'You' : message.username
        }}</strong
        ><time :datetime="message.created_at">{{ time }}</time>
      </div>
      <p v-if="message.deleted_at" class="muted">Message deleted.</p>
      <p v-else>{{ message.content }}</p>
    </div>
  </article>
</template>
