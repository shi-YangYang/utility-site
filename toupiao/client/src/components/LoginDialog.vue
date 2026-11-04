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

          <p v-if="authMode === 'mock'" class="dev-notice">
            <strong>开发模式</strong>：输入任意姓名即可模拟登录，仅限本地开发与验收；线上必须使用钉钉登录。
          </p>

          <h2 id="login-title">登录后参与投票</h2>
          <p class="modal-desc">
            一人最多投 5 个不同图标。前台只公开票数与排名，不会展示投票人姓名。
          </p>

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
            <p class="field-hint">1–20 个字符；同名会视为同一位员工。</p>
            <p v-if="errorText" class="form-error" role="alert">{{ errorText }}</p>
            <button type="submit" class="btn btn-primary btn-block" :disabled="busy">
              {{ busy ? '登录中…' : '进入投票' }}
            </button>
          </form>

          <div v-else class="dingtalk-block">
            <p>使用钉钉扫码登录，授权成功后会自动回到投票页。</p>
            <a class="btn btn-primary btn-block" :href="loginHref">使用钉钉登录</a>
            <p class="field-hint">在钉钉内置浏览器中同样可用；若无法打开，请复制链接到系统浏览器。</p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
