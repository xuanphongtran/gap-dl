import { createRouter, createWebHistory } from 'vue-router'
import { readSession } from './lib/session'
import AuthView from './views/AuthView.vue'
import AppShell from './views/AppShell.vue'
import EmptyView from './views/EmptyView.vue'
import RoomView from './views/RoomView.vue'
import SettingsView from './views/SettingsView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/app' },
    { path: '/login', component: AuthView, props: { mode: 'login' }, meta: { guest: true } },
    { path: '/register', component: AuthView, props: { mode: 'register' }, meta: { guest: true } },
    {
      path: '/app',
      component: AppShell,
      meta: { auth: true },
      children: [
        { path: '', component: EmptyView },
        { path: 'rooms/:id', component: RoomView },
        { path: 'settings', component: SettingsView },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/app' },
  ],
})

router.beforeEach((to) => {
  if (to.matched.some((route) => route.meta.auth) && !readSession()) return '/login'
  if (to.meta.guest && readSession()) return '/app'
})
