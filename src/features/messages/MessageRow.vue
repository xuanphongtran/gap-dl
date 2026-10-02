<script setup lang="ts">
import PixelAvatar from '../../components/base/PixelAvatar.vue'
import PixelButton from '../../components/base/PixelButton.vue'
import { MAX_MESSAGE_BYTES, messageContentBytes } from '../../lib/messages'
import type { Message } from '../../types'

defineProps<{
  message: Message
  mine: boolean
  time: string
  canEdit?: boolean
  canDelete?: boolean
  editing?: boolean
  editDraft?: string
  editError?: string
  conflict?: Message | null
  saving?: boolean
  deleting?: boolean
  editCooldown?: number
  deleteCooldown?: number
}>()
const emit = defineEmits<{
  edit: []
  save: []
  cancel: []
  discard: []
  delete: []
  'update:editDraft': [value: string]
}>()
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
      <small v-if="message.edited_at && !message.deleted_at" class="message-edited">Edited</small>
      <form v-if="editing" class="message-editor" @submit.prevent="emit('save')">
        <label :for="`edit-message-${message.id}`">Edit message</label>
        <textarea
          :id="`edit-message-${message.id}`"
          :value="editDraft"
          rows="3"
          :disabled="saving"
          :aria-invalid="!!editError || messageContentBytes(editDraft || '') > MAX_MESSAGE_BYTES"
          :aria-describedby="`edit-feedback-${message.id}`"
          @input="emit('update:editDraft', ($event.target as HTMLTextAreaElement).value)"
        ></textarea>
        <div :id="`edit-feedback-${message.id}`" class="message-edit-feedback">
          <span
            >{{ messageContentBytes(editDraft || '') }}/{{ MAX_MESSAGE_BYTES }} UTF-8 bytes</span
          >
          <span v-if="messageContentBytes(editDraft || '') > MAX_MESSAGE_BYTES" role="alert">
            Message exceeds the 4000-byte UTF-8 limit.
          </span>
          <span v-if="editError" role="alert">{{ editError }}</span>
        </div>
        <div v-if="conflict" class="message-conflict" role="status">
          <strong>This message changed while you were editing.</strong>
          <p v-if="conflict.deleted_at">The server version was deleted.</p>
          <p v-else>{{ conflict.content }}</p>
        </div>
        <div class="message-actions">
          <PixelButton
            variant="primary"
            type="submit"
            :disabled="
              saving ||
              !!editCooldown ||
              !!conflict?.deleted_at ||
              !editDraft?.trim() ||
              messageContentBytes(editDraft || '') > MAX_MESSAGE_BYTES
            "
            >{{
              saving
                ? 'SAVING...'
                : editCooldown
                  ? `RETRY IN ${editCooldown}s`
                  : conflict
                    ? 'RETRY SAVE'
                    : 'SAVE'
            }}</PixelButton
          >
          <PixelButton type="button" @click="conflict ? emit('discard') : emit('cancel')">
            {{ conflict ? 'DISCARD DRAFT' : 'CANCEL' }}
          </PixelButton>
        </div>
      </form>
      <div v-else-if="!message.deleted_at && (canEdit || canDelete)" class="message-actions">
        <button v-if="canEdit" type="button" @click="emit('edit')">Edit</button>
        <button
          v-if="canDelete"
          type="button"
          :disabled="deleting || !!deleteCooldown"
          @click="emit('delete')"
        >
          {{ deleting ? 'Deleting...' : deleteCooldown ? `Retry in ${deleteCooldown}s` : 'Delete' }}
        </button>
      </div>
    </div>
  </article>
</template>
