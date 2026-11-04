import { createRouter, createWebHistory } from 'vue-router';
import VoteView from './views/VoteView.vue';
import AdminView from './views/AdminView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'vote', component: VoteView },
    { path: '/admin', name: 'admin', component: AdminView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});

export default router;
