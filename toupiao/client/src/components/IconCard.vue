<script setup>
import { computed } from 'vue';

const props = defineProps({
  icon: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  pending: { type: Boolean, default: false },
  votingOpen: { type: Boolean, default: true },
  limitReached: { type: Boolean, default: false },
  maxCount: { type: Number, default: 0 },
});

defineEmits(['toggle']);

const blocked = computed(
  () => props.pending || !props.votingOpen || (props.limitReached && !props.selected),
);

const actionText = computed(() => {
  if (props.pending) return '提交中…';
  if (props.selected) return props.votingOpen ? '点击取消' : '已选（投票已结束）';
  if (!props.votingOpen) return '投票已结束';
  if (props.limitReached) return '已满 5 票';
  return '点击投票';
});

const barWidth = computed(() => {
  if (!props.maxCount || props.icon.count <= 0) return '0%';
  const ratio = props.icon.count / props.maxCount;
  return `${Math.max(6, Math.round(ratio * 100))}%`;
});

const ariaLabel = computed(() => {
  const base = `${props.icon.name}，${props.icon.count} 票，第 ${props.icon.rank} 名`;
  if (props.selected) {
    return props.votingOpen
      ? `${base}，已选中，点击取消投票`
      : `${base}，已选中，投票已结束`;
  }
  if (!props.votingOpen) return `${base}，投票已结束`;
  if (props.limitReached) return `${base}，已满 5 票，请先取消一个`;
  return `${base}，点击投票`;
});
</script>

<template>
  <article
    class="icon-card"
    :class="{
      'is-selected': selected,
      'is-blocked': blocked,
      'is-pending': pending,
    }"
    :data-icon-id="icon.id"
  >
    <button
      type="button"
      class="icon-button"
      :aria-pressed="selected"
      :disabled="pending"
      :aria-label="ariaLabel"
      @click="$emit('toggle', icon)"
    >
      <span class="icon-index" aria-hidden="true">#{{ icon.id }}</span>
      <span v-if="selected" class="selected-badge" aria-hidden="true">✓ 已选</span>
      <span v-else-if="icon.count > 0 && icon.rank === 1" class="rank-badge" aria-hidden="true">
        第 1 名
      </span>

      <span class="icon-media">
        <img :src="icon.url" :alt="icon.name" loading="lazy" decoding="async" width="277" height="191" />
      </span>

      <span class="icon-name">{{ icon.name }}</span>
      <span class="icon-meta">
        <strong>{{ icon.count }}</strong> 票
        <span class="dot" aria-hidden="true">·</span>
        <span>第 {{ icon.rank }} 名</span>
      </span>
      <span class="vote-meter" aria-hidden="true">
        <span class="vote-meter-fill" :style="{ width: barWidth }"></span>
      </span>
      <span class="icon-action">{{ actionText }}</span>
    </button>
  </article>
</template>
