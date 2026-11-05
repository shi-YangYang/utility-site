<script setup>
defineProps({
  user: { type: Object, default: null },
  isAdmin: { type: Boolean, default: false },
});

defineEmits(['logout']);
</script>

<template>
  <header class="app-header">
    <div class="header-inner">
      <router-link to="/" class="brand" aria-label="Esonitro Logo 评选投票首页">
        <span class="brand-mark" aria-hidden="true">E</span>
        <span class="brand-text">
          <strong>Esonitro</strong>
          <span>Logo 评选投票</span>
        </span>
      </router-link>

      <nav class="header-actions" aria-label="账号与导航">
        <template v-if="isAdmin">
          <span class="user-chip">
            <span class="avatar avatar-admin" aria-hidden="true">管</span>
            <span class="user-name">管理员</span>
          </span>
          <router-link to="/" class="btn btn-ghost">返回投票页</router-link>
          <button type="button" class="btn btn-ghost" @click="$emit('logout')">退出后台</button>
        </template>
        <template v-else-if="user">
          <span class="user-chip">
            <img
              v-if="user.avatarUrl"
              :src="user.avatarUrl"
              alt=""
              class="avatar"
              referrerpolicy="no-referrer"
            />
            <span v-else class="avatar avatar-fallback">{{ user.nick.slice(0, 1) }}</span>
            <span class="user-name">{{ user.nick }}</span>
          </span>
          <button type="button" class="btn btn-ghost" @click="$emit('logout')">退出登录</button>
        </template>
        <template v-else>
          <router-link v-if="$route.path !== '/admin'" to="/admin" class="btn btn-ghost">
            管理后台
          </router-link>
        </template>
      </nav>
    </div>
  </header>
</template>
