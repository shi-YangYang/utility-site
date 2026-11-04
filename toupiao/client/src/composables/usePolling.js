import { onMounted, onUnmounted } from 'vue';

/**
 * 可见性感知轮询：页面隐藏时跳过请求，重新可见时立即刷新一次。
 * @param {() => Promise<unknown>} task
 * @param {number} intervalMs
 */
export function usePolling(task, intervalMs = 5000) {
  let timer = null;
  let running = false;
  let disposed = false;

  async function tick() {
    if (disposed || running) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    running = true;
    try {
      await task();
    } catch {
      /* 调用方自行展示错误；轮询失败保持旧数据 */
    } finally {
      running = false;
    }
  }

  function start() {
    stop();
    timer = setInterval(tick, intervalMs);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function onVisibilityChange() {
    if (!document.hidden) tick();
  }

  onMounted(() => {
    tick();
    start();
    document.addEventListener('visibilitychange', onVisibilityChange);
  });

  onUnmounted(() => {
    disposed = true;
    stop();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });

  return { refresh: tick, start, stop };
}
