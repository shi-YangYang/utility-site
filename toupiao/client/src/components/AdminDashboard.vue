<script setup>
import { computed, nextTick, ref } from 'vue';
import DingTalkSettings from './DingTalkSettings.vue';
import IconUpload from './IconUpload.vue';

const props = defineProps({
  admin: { type: Object, required: true },
  voters: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['refresh', 'toggle', 'reset']);

const sortMode = ref('recent');
const resetOpen = ref(false);
const resetConfirm = ref('');
const resetInput = ref(null);

const sortedVoters = computed(() => {
  const list = [...props.voters];
  if (sortMode.value === 'votes') {
    list.sort((a, b) => b.votes.length - a.votes.length || a.nick.localeCompare(b.nick, 'zh'));
  } else if (sortMode.value === 'name') {
    list.sort((a, b) => a.nick.localeCompare(b.nick, 'zh'));
  }
  return list;
});

const maxCount = computed(() => Math.max(1, ...props.admin.icons.map((icon) => icon.count)));

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function barWidth(icon) {
  if (icon.count <= 0) return '0%';
  return `${Math.max(4, Math.round((icon.count / maxCount.value) * 100))}%`;
}

async function openReset() {
  resetConfirm.value = '';
  resetOpen.value = true;
  await nextTick();
  resetInput.value?.focus();
}

function closeReset() {
  resetOpen.value = false;
  resetConfirm.value = '';
}

function confirmReset() {
  if (resetConfirm.value !== 'RESET') return;
  emit('reset', resetConfirm.value);
  closeReset();
}
</script>

<template>
  <div class="admin-dashboard">
    <div v-if="!admin.iconsAvailable" class="warning-banner warning-icons" role="status">
      <strong>暂无候选图标</strong>
    </div>

    <section class="admin-hero">
      <div>
        <p class="eyebrow">Esonitro · 管理后台</p>
        <h1>投票管理</h1>
      </div>
      <div class="admin-hero-actions">
        <button type="button" class="btn" :disabled="busy" @click="$emit('refresh')">
          刷新数据
        </button>
        <a class="btn" href="/api/admin/export.csv" download>导出 CSV</a>
      </div>
    </section>

    <section class="stat-grid" aria-label="投票统计">
      <article class="stat-card">
        <span class="stat-label">总票数</span>
        <strong class="stat-value" data-testid="admin-total-votes">{{ admin.totalVotes }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">参与人数</span>
        <strong class="stat-value" data-testid="admin-voters-count">{{ admin.votersCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">候选图标</span>
        <strong class="stat-value">{{ admin.iconCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">投票状态</span>
        <span class="status-pill" :class="{ closed: !admin.votingOpen }">
          {{ admin.votingOpen ? '进行中' : '已关闭' }}
        </span>
      </article>
    </section>

    <section class="panel control-panel">
      <div class="control-copy">
        <h2>投票开关</h2>
        <span class="status-pill" :class="{ closed: !admin.votingOpen }">
          {{ admin.votingOpen ? '进行中' : '已关闭' }}
        </span>
      </div>
      <button
        type="button"
        class="btn"
        :class="admin.votingOpen ? 'btn-danger' : 'btn-primary'"
        :disabled="busy"
        @click="$emit('toggle')"
      >
        {{ admin.votingOpen ? '关闭投票' : '开启投票' }}
      </button>
    </section>

    <DingTalkSettings />

    <IconUpload :count="admin.iconCount" @uploaded="$emit('refresh')" />

    <div class="admin-columns">
      <section class="panel" aria-labelledby="admin-icons-title">
        <div class="panel-head">
          <h2 id="admin-icons-title">各图标票数</h2>
          <span class="muted">共 {{ admin.totalVotes }} 票</span>
        </div>
        <div class="table-wrap">
          <table class="data-table" data-testid="admin-icons-table">
            <thead>
              <tr>
                <th scope="col">排名</th>
                <th scope="col">图标</th>
                <th scope="col">票数</th>
                <th scope="col">占比</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="icon in admin.icons" :key="icon.id">
                <td>{{ icon.rank }}</td>
                <td>
                  <div class="table-icon">
                    <img :src="icon.url" :alt="icon.name" loading="lazy" />
                    <span>{{ icon.name }}</span>
                    <span class="muted">#{{ icon.id }}</span>
                  </div>
                </td>
                <td><strong>{{ icon.count }}</strong></td>
                <td>
                  <div class="share-cell">
                    <span class="share-bar" aria-hidden="true">
                      <span :style="{ width: barWidth(icon) }"></span>
                    </span>
                    <span>{{ icon.share }}%</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!admin.icons.length" class="empty-hint">
          暂无候选图标
        </p>
      </section>

      <section class="panel" aria-labelledby="recent-title">
        <div class="panel-head">
          <h2 id="recent-title">最近投票</h2>
          <span class="muted">最近 20 条</span>
        </div>
        <ol v-if="admin.recentVotes.length" class="recent-list">
          <li v-for="(vote, index) in admin.recentVotes" :key="`${vote.createdAt}-${index}`">
            <span class="recent-name">{{ vote.nick }}</span>
            <span class="recent-icon">#{{ vote.iconId }} {{ vote.iconName }}</span>
            <time :datetime="vote.createdAt">{{ formatTime(vote.createdAt) }}</time>
          </li>
        </ol>
        <p v-else class="empty-hint">还没有投票记录。</p>
      </section>
    </div>

    <section class="panel" aria-labelledby="voters-title">
      <div class="panel-head">
        <h2 id="voters-title">投票人明细</h2>
        <label class="sort-control">
          排序
          <select v-model="sortMode">
            <option value="recent">最近投票</option>
            <option value="votes">票数从多到少</option>
            <option value="name">姓名</option>
          </select>
        </label>
      </div>

      <div v-if="sortedVoters.length" class="table-wrap">
        <table class="data-table voters-table">
          <thead>
            <tr>
              <th scope="col">姓名</th>
              <th scope="col">已投图标</th>
              <th scope="col">票数</th>
              <th scope="col">最近投票</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="voter in sortedVoters" :key="`${voter.nick}-${voter.lastVotedAt}`">
              <td>
                <div class="voter-name">
                  <span class="avatar avatar-fallback" aria-hidden="true">
                    {{ voter.nick.slice(0, 1) }}
                  </span>
                  <span>{{ voter.nick }}</span>
                </div>
              </td>
              <td>
                <ul class="vote-chips">
                  <li
                    v-for="vote in voter.votes"
                    :key="vote.iconId"
                    :title="`投票时间：${formatTime(vote.createdAt)}`"
                  >
                    #{{ vote.iconId }} {{ vote.iconName }}
                  </li>
                </ul>
              </td>
              <td>{{ voter.votes.length }}</td>
              <td>
                <time :datetime="voter.lastVotedAt">{{ formatTime(voter.lastVotedAt) }}</time>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty-hint">还没有人投票。</p>
    </section>

    <section class="panel danger-zone" aria-labelledby="reset-title">
      <div>
        <h2 id="reset-title">重置投票</h2>
      </div>
      <button type="button" class="btn btn-danger" @click="openReset">重置投票…</button>
    </section>

    <Teleport to="body">
      <div v-if="resetOpen" class="modal-backdrop" @click.self="closeReset">
        <div
          class="modal-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-dialog-title"
          @keydown.esc.stop="closeReset"
        >
          <button type="button" class="modal-close" aria-label="关闭重置确认" @click="closeReset">
            ×
          </button>
          <h2 id="reset-dialog-title">确认重置投票</h2>
          <p>
            删除 <strong>{{ admin.totalVotes }}</strong> 条投票记录，无法恢复。
            请输入大写 <code>RESET</code> 确认。
          </p>
          <label for="reset-confirm">确认词</label>
          <input
            id="reset-confirm"
            ref="resetInput"
            v-model="resetConfirm"
            type="text"
            autocomplete="off"
            placeholder="RESET"
            :disabled="busy"
          />
          <div class="modal-actions">
            <button type="button" class="btn" @click="closeReset">取消</button>
            <button
              type="button"
              class="btn btn-danger"
              :disabled="resetConfirm !== 'RESET' || busy"
              @click="confirmReset"
            >
              确认重置
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
