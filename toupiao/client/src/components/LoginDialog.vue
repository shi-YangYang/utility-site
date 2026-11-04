<script setup>
import { computed, nextTick, ref, watch } from 'vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  authMode: { type: String, default: 'dingtalk' },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
});

const emit = defineEmits(['close', 'login']);

const name = ref('');
const localError = ref('');
const nameInput = ref(null);
const closeButton = ref(null);

const errorText = computed(() => localError.value || props.error);

const loginHref = computed(() => {
  const next = typeof window === 'undefined' ? '/' : window.location.pathname;
  return `/api/auth/login?next=${encodeURIComponent(next)}`;
});

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      name.value = '';
      localError.value = '';
      document.body.style.overflow = '';
      return;
    }
    document.body.style.overflow = 'hidden';
    await nextTick();
    (nameInput.value ?? closeButton.value)?.focus();
  },
);

watch(
  () => props.error,
  () => {
    localError.value = '';
  },
);

function close() {
  emit('close');
}

function submit() {
  const trimmed = name.value.trim();
  if (!trimmed) {
    localError.value = '请输入你的姓名';
    return;
  }
  if (trimmed.length > 20) {
    localError.value = '姓名最多 20 个字符';
    return;
  }
  localError.value = '';
  emit('login', trimmed);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-backdrop" @click.self="close">
        <div
          class="modal-card login-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="login-title"
          @keydown.esc.stop="close"
        >
          <button
            ref="closeButton"
            type="button"
            class="modal-close"
            aria-label="关闭登录弹窗"
            @click="close"
          >
            ×
          </button>

          <h2 id="login-title">登录后参与投票</h2>

          <form v-if="authMode === 'mock'" class="login-form" @submit.prevent="submit">
            <label for="mock-name">你的姓名</label>
            <input
              id="mock-name"
              ref="nameInput"
              v-model="name"
              type="text"
              maxlength="20"
              autocomplete="name"
              placeholder="例如：张三"
              :disabled="busy"
            />
            <p v-if="errorText" class="form-error" role="alert">{{ errorText }}</p>
            <button type="submit" class="btn btn-primary btn-block" :disabled="busy">
              {{ busy ? '登录中…' : '进入投票' }}
            </button>
          </form>

          <div v-else class="dingtalk-block">
            <a class="btn btn-primary btn-block" :href="loginHref">使用钉钉登录</a>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
