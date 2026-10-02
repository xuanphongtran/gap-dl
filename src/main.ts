import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
import App from './App.vue'
import { bindSessionCache, queryClient } from './lib/query'
import { router } from './router'
import './style.css'

bindSessionCache()

createApp(App).use(createPinia()).use(VueQueryPlugin, { queryClient }).use(router).mount('#app')
