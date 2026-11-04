<script setup>
import { computed } from 'vue';

const props = defineProps({
  icons: { type: Array, default: () => [] },
  myVotes: { type: Array, default: () => [] },
  maxVotes: { type: Number, default: 5 },
  votingOpen: { type: Boolean, default: true },
  user: { type: Object, default: null },
});

defineEmits(['cancel', 'login']);

const selectedIcons = computed(() =>
  props.myVotes
    .map((id) => props.icons.find((icon) => icon.id === id))
    .filter((icon) => Boolean(icon)),
);

const remaining = computed(() => Math.max(0, props.maxVotes - props.myVotes.length));
</script>

<template>
  <section class="panel my-votes" aria-labelledby="my-votes-title">
    <div class="panel-head">
      <h2 id="my-votes-title">我的投票</h2>
      <span class="count-pill" data-testid="my-votes-count">{{ myVotes.length }}/{{ maxVotes }}</span>
    </div>

    <template v-if="user">
      <p class="remaining">
        还可投 <strong>{{ remaining }}</strong> 个图标
        <span v-if="!votingOpen" class="muted">（投票已结束）</span>
      </p>

      <ul v-if="selectedIcons.length" class="selected-list">
        <li v-for="icon in selectedIcons" :key="icon.id">
          <img :src="icon.url" :alt="icon.name" loading="lazy" />
          <span class="selected-name">{{ icon.name }}</span>
          <button
            type="button"
            class="remove-btn"
            :disabled="!votingOpen"
            :aria-label="`取消「${icon.name}」的投票`"
            @click="$emit('cancel', icon)"
          >
            取消
          </button>
        </li>
      </ul>
      <p v-else class="empty-hint">还没有投票，点击候选图标开始吧。</p>

      <p v-if="!votingOpen" class="frozen-hint">投票已冻结，已投记录保持不变。</p>
    </template>

    <template v-else>
      <p class="empty-hint">登录后才能投票；现在可以先浏览候选与实时票数。</p>
      <button type="button" class="btn btn-primary btn-block" @click="$emit('login')">
        登录参与投票
      </button>
    </template>
  </section>
</template>
