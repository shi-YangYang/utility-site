<script setup>
import { useToast } from '../composables/useToast.js';

const { toasts, dismissToast } = useToast();
</script>

<template>
  <Teleport to="body">
    <div class="toast-host" aria-live="polite" aria-atomic="false">
      <TransitionGroup name="toast">
        <div
          v-for="item in toasts.items"
          :key="item.id"
          class="toast"
          :class="`toast-${item.type}`"
          role="status"
        >
          <span class="toast-message">{{ item.message }}</span>
          <button
            type="button"
            class="toast-close"
            aria-label="关闭提示"
            @click="dismissToast(item.id)"
          >
            ×
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
