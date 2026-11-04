/**
 * 极简内存限流：按 key（IP / IP+动作）记录时间窗内的次数。
 * 单实例部署足够；重启后计数清零可接受。
 */
export function createRateLimiter({ windowMs, max, now = () => Date.now() }) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error('windowMs 必须为正数');
  if (!Number.isInteger(max) || max <= 0) throw new Error('max 必须为正整数');
  const attempts = new Map();

  function pruneList(list, timestamp) {
    return list.filter((value) => timestamp - value < windowMs);
  }

  function cleanup(timestamp) {
    for (const [key, list] of attempts) {
      const kept = pruneList(list, timestamp);
      if (kept.length === 0) attempts.delete(key);
      else attempts.set(key, kept);
    }
  }

  return {
    check(key) {
      const timestamp = now();
      const list = pruneList(attempts.get(key) ?? [], timestamp);
      if (list.length === 0) {
        attempts.delete(key);
        return { allowed: true, remaining: max, retryAfterMs: 0 };
      }
      attempts.set(key, list);
      if (list.length >= max) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: Math.max(0, windowMs - (timestamp - list[0])),
        };
      }
      return { allowed: true, remaining: max - list.length, retryAfterMs: 0 };
    },

    record(key) {
      const timestamp = now();
      if (attempts.size > 5000) cleanup(timestamp);
      const list = pruneList(attempts.get(key) ?? [], timestamp);
      list.push(timestamp);
      attempts.set(key, list);
    },

    reset(key) {
      attempts.delete(key);
    },

    get size() {
      return attempts.size;
    },
  };
}
