<script setup>
import { computed, nextTick, ref } from 'vue';

const props = defineProps({
  admin: { type: Object, required: true },
  voters: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['refresh', 'toggle', 'logout', 'reset']);

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
      <strong>图标目录为空</strong>：前台暂时没有可投票的候选图。请把
      <code>NN_名称.png</code> 放进 <code>assets/icons/</code> 后重启服务。
    </div>

    <section class="admin-hero">
      <div>
        <p class="eyebrow">Esonitro · 管理后台</p>
        <h1>投票管理</h1>
        <p class="hero-desc">
          查看实时统计与投票人明细、开关投票、导出 CSV。管理员账号不能参与投票。
        </p>
      </div>
      <div class="admin-hero-actions">
        <button type="button" class="btn" :disabled="busy" @click="$emit('refresh')">
          刷新数据
        </button>
        <a class="btn" href="/api/admin/export.csv" download>导出 CSV</a>
        <button type="button" class="btn btn-ghost" @click="$emit('logout')">退出后台</button>
      </div>
    </section>

    <section class="stat-grid" aria-label="投票统计">
      <article class="stat-card">
        <span class="stat-label">总票数</span>
        <strong class="stat-value" data-testid="admin-total-votes">{{ admin.totalVotes }}</strong>
        <span class="stat-hint">每票对应一个图标</span>
      </article>
      <article class="stat-card">
        <span class="stat-label">参与人数</span>
        <strong class="stat-value" data-testid="admin-voters-count">{{ admin.votersCount }}</strong>
        <span class="stat-hint">注册用户 {{ admin.userCount }} 人</span>
      </article>
      <article class="stat-card">
        <span class="stat-label">候选图标</span>
        <strong class="stat-value">{{ admin.iconCount }}</strong>
        <span class="stat-hint">每人最多 {{ admin.maxVotes }} 票</span>
      </article>
      <article class="stat-card">
        <span class="stat-label">投票状态</span>
        <span class="status-pill" :class="{ closed: !admin.votingOpen }">
          {{ admin.votingOpen ? '进行中' : '已关闭' }}
        </span>
        <span class="stat-hint">{{ admin.votingOpen ? '员工可以投票与取消' : '所有修改已冻结' }}</span>
      </article>
    </section>

    <section class="panel control-panel">
      <div>
        <h2>投票开关</h2>
        <p class="muted">
          关闭后，新增投票与取消投票都会立即被拒绝，票数继续公开展示；重新开启后恢复。
        </p>
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

    <div class="admin-columns">
      <section class="panel" aria-labelledby="admin-icons-title">
        <div class="panel-head">
          <h2 id="admin-icons-title">各图标票数</h2>
          <span class="muted">共 {{ admin.totalVotes }} 票</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
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
          图标目录为空，先上传候选图并重启服务。
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
      <p class="privacy-note">
        此区域包含投票人姓名，仅管理员可见。请勿截图公开分享。
      </p>

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
        <p class="muted">
          清空所有投票记录（保留用户账号）。操作不可恢复，建议先导出 CSV 并备份数据库。
        </p>
      </div>
      <button type="button" class="btn btn-danger" @click="openReset">重置投票…</button>
    </section>

    <footer class="admin-footer">
      <span>站点地址：{{ admin.publicBaseUrl }}</span>
      <span>登录方式：{{ admin.authMode === 'mock' ? 'mock（开发模式）' : '钉钉扫码' }}</span>
    </footer>

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
            这将删除 <strong>{{ admin.totalVotes }}</strong> 条投票记录，且无法恢复。
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
