<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  icons: { type: Array, default: () => [] },
});

const expanded = ref(false);

const sorted = computed(() =>
  [...props.icons].sort(
    (a, b) => b.count - a.count || Number(a.id) - Number(b.id),
  ),
);

const visible = computed(() => (expanded.value ? sorted.value : sorted.value.slice(0, 5)));

const maxCount = computed(() => Math.max(1, ...props.icons.map((icon) => icon.count)));

function barWidth(icon) {
  if (icon.count <= 0) return '0%';
  return `${Math.max(6, Math.round((icon.count / maxCount.value) * 100))}%`;
}
</script>

<template>
  <section class="panel leaderboard" aria-labelledby="leaderboard-title">
    <div class="panel-head">
      <h2 id="leaderboard-title">实时排行</h2>
      <button
        v-if="icons.length > 5"
        type="button"
        class="link-btn"
        @click="expanded = !expanded"
      >
        {{ expanded ? '收起' : '查看全部' }}
      </button>
    </div>

    <p v-if="!icons.length" class="empty-hint">暂无候选图标。</p>

    <ol v-else class="rank-list">
      <li v-for="icon in visible" :key="icon.id">
        <span class="rank-num" aria-hidden="true">{{ icon.count > 0 ? icon.rank : '–' }}</span>
        <img :src="icon.url" :alt="icon.name" loading="lazy" />
        <span class="rank-name">{{ icon.name }}</span>
        <span class="rank-count">{{ icon.count }} 票</span>
        <span class="rank-bar" aria-hidden="true">
          <span :style="{ width: barWidth(icon) }"></span>
        </span>
      </li>
    </ol>

    <p class="rank-note">排名按票数降序，票数相同并列。</p>
  </section>
</template>
