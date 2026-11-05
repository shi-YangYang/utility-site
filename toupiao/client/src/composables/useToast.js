import { readonly, reactive } from 'vue';

const state = reactive({ items: [] });
const timers = new Map();
let sequence = 0;

export function dismissToast(id) {
  const index = state.items.findIndex((item) => item.id === id);
  if (index >= 0) state.items.splice(index, 1);
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

export function showToast(message, type = 'info', duration = type === 'error' ? 5000 : 3500) {
  const id = ++sequence;
  state.items.push({ id, message, type });
  if (duration > 0) {
    timers.set(
      id,
      setTimeout(() => dismissToast(id), duration),
    );
  }
  return id;
}

export const toast = {
  info: (message, duration) => showToast(message, 'info', duration),
  success: (message, duration) => showToast(message, 'success', duration),
  error: (message, duration) => showToast(message, 'error', duration),
};

export function useToast() {
  return {
    toasts: readonly(state),
    toast,
    dismissToast,
  };
}
