<script setup>
import { onMounted, ref } from 'vue';
import AppHeader from '../components/AppHeader.vue';
import AdminDashboard from '../components/AdminDashboard.vue';
import AdminLogin from '../components/AdminLogin.vue';
import { api } from '../api.js';
import { toast } from '../composables/useToast.js';

const admin = ref(null);
const voters = ref([]);
const loading = ref(true);
const authenticated = ref(false);
const loginBusy = ref(false);
const loginError = ref('');
const actionBusy = ref(false);

async function load({ silent = false } = {}) {
  try {
    const [nextAdmin, nextVoters] = await Promise.all([api.getAdminState(), api.getVoters()]);
    admin.value = nextAdmin;
    voters.value = nextVoters;
    authenticated.value = true;
    loginError.value = '';
  } catch (error) {
    if (error.status === 401) {
      authenticated.value = false;
      admin.value = null;
    } else if (error.status === 403) {
      authenticated.value = false;
      admin.value = null;
      loginError.value = '请使用管理口令登录';
    } else if (!silent) {
      loginError.value = error.message;
    }
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
});

async function handleAdminLogin(password) {
  loginBusy.value = true;
  loginError.value = '';
  try {
    await api.adminLogin(password);
    authenticated.value = true;
    await load({ silent: true });
    toast.success('已登录管理后台');
  } catch (error) {
    loginError.value =
      error.status === 429 ? error.message : '管理口令不正确，请重试';
  } finally {
    loginBusy.value = false;
  }
}

async function handleToggleVoting() {
  if (!admin.value) return;
  const next = !admin.value.votingOpen;
  actionBusy.value = true;
  try {
    await api.setVotingOpen(next);
    toast.success(next ? '投票已开启' : '投票已关闭');
    await load({ silent: true });
  } catch (error) {
    toast.error(error.message);
  } finally {
    actionBusy.value = false;
  }
}

async function handleReset(confirm) {
  actionBusy.value = true;
  try {
    await api.resetVotes(confirm);
    toast.success('投票已重置');
    await load({ silent: true });
  } catch (error) {
    toast.error(error.message);
  } finally {
    actionBusy.value = false;
  }
}

async function handleLogout() {
  try {
    await api.adminLogout();
  } catch {
    /* 会话过期时也允许退出界面 */
  }
  authenticated.value = false;
  admin.value = null;
  voters.value = [];
  loginError.value = '';
  toast.info('已退出管理后台');
}
</script>

<template>
  <div class="page admin-page">
    <AppHeader
      :user="null"
      :is-admin="authenticated"
      @logout="handleLogout"
    />

    <main class="page-main">
      <div v-if="loading" class="loading-panel" aria-busy="true">正在加载后台数据…</div>

      <template v-else-if="!authenticated">
        <AdminLogin :busy="loginBusy" :error="loginError" @submit="handleAdminLogin" />
      </template>

      <AdminDashboard
        v-else-if="admin"
        :admin="admin"
        :voters="voters"
        :busy="actionBusy"
        @refresh="load({ silent: true })"
        @toggle="handleToggleVoting"
        @reset="handleReset"
      />
    </main>
  </div>
</template>
