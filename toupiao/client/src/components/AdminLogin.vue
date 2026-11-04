<script setup>
import { nextTick, onMounted, ref } from 'vue';

defineProps({
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
});

const emit = defineEmits(['submit']);

const password = ref('');
const passwordInput = ref(null);

onMounted(() => {
  nextTick(() => passwordInput.value?.focus());
});

function submit() {
  if (!password.value) return;
  emit('submit', password.value);
}
</script>

<template>
  <section class="admin-login panel" aria-labelledby="admin-login-title">
    <p class="eyebrow">Esonitro · 管理后台</p>
    <h1 id="admin-login-title">管理员登录</h1>
    <p class="modal-desc">
      管理后台使用独立口令，与员工钉钉账号无关。口令由部署者在
      <code>.env</code> 的 <code>ADMIN_PASSWORD</code> 中配置。
    </p>

    <form class="login-form" @submit.prevent="submit">
      <label for="admin-password">管理口令</label>
      <input
        id="admin-password"
        ref="passwordInput"
        v-model="password"
        type="password"
        autocomplete="current-password"
        placeholder="请输入管理口令"
        :disabled="busy"
      />
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button type="submit" class="btn btn-primary btn-block" :disabled="busy || !password">
        {{ busy ? '验证中…' : '进入后台' }}
      </button>
    </form>

    <p class="field-hint">
      连续输错会被限流（每 IP 5 分钟最多 10 次），请确认口令后重新尝试。
    </p>
    <router-link to="/" class="back-link">← 返回投票页</router-link>
  </section>
</template>
