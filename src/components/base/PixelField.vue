<script setup lang="ts">
import { computed, useAttrs, useId } from 'vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    label: string
    modelValue?: string
    as?: 'input' | 'select'
    hint?: string
    error?: string
    id?: string
  }>(),
  { as: 'input' },
)
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const attrs = useAttrs()
const generatedId = useId()
const controlId = computed(() => props.id || generatedId)
const helpId = computed(() => `${controlId.value}-help`)
function describedBy() {
  const external = attrs['aria-describedby']
  const ids = [
    typeof external === 'string' ? external : '',
    props.hint || props.error ? helpId.value : '',
  ]
  return ids.filter(Boolean).join(' ') || undefined
}

function invalid() {
  return props.error ? true : (attrs['aria-invalid'] as boolean | 'true' | 'false' | undefined)
}

function update(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement | HTMLSelectElement).value)
}
</script>

<template>
  <div class="field">
    <label :for="controlId">{{ label }}</label>
    <input
      v-if="as === 'input'"
      :id="controlId"
      v-bind="$attrs"
      :value="modelValue"
      :aria-invalid="invalid()"
      :aria-describedby="describedBy()"
      @input="update"
    />
    <select
      v-else
      :id="controlId"
      v-bind="$attrs"
      :value="modelValue"
      :aria-invalid="invalid()"
      :aria-describedby="describedBy()"
      @change="update"
    >
      <slot />
    </select>
    <small v-if="error || hint" :id="helpId" class="field-help" :class="{ 'field-error': error }">
      {{ error || hint }}
    </small>
  </div>
</template>
