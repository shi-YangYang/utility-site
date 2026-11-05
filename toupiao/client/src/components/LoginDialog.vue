<script setup>
import { computed, nextTick, ref, watch } from 'vue';

const props = defineProps({
  open: { type: Boolean, default: false },
});

const emit = defineEmits(['close']);

const closeButton = ref(null);

const loginHref = computed(() => {
  const next =
    typeof window === 'undefined'
      ? '/'
      : `${window.location.pathname}${window.location.search}`;
  return `/api/auth/login?next=${encodeURIComponent(next)}`;
});

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      document.body.style.overflow = '';
      return;
    }
    document.body.style.overflow = 'hidden';
    await nextTick();
    closeButton.value?.focus();
  },
);

function close() {
  emit('close');
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

          <a class="btn btn-primary btn-block" :href="loginHref">使用钉钉登录</a>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
