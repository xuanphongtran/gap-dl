import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
import App from './App.vue'
import { queryClient } from './lib/query'
import { readSession } from './lib/session'
import { router } from './router'
import './style.css'

window.addEventListener('session:changed', () => {
  if (!readSession()) queryClient.clear()
})

createApp(App).use(createPinia()).use(VueQueryPlugin, { queryClient }).use(router).mount('#app')
