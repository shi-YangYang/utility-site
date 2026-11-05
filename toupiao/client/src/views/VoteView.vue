<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import AppHeader from '../components/AppHeader.vue';
import IconCard from '../components/IconCard.vue';
import Leaderboard from '../components/Leaderboard.vue';
import LoginDialog from '../components/LoginDialog.vue';
import VoteSummary from '../components/VoteSummary.vue';
import { api } from '../api.js';
import { usePolling } from '../composables/usePolling.js';
import { toast } from '../composables/useToast.js';

const AUTH_ERROR_MESSAGES = {
  STATE_INVALID: '登录状态校验失败，请重新登录',
  CODE_MISSING: '登录回调缺少授权码，请重新登录',
  DENIED: '你取消了钉钉授权，未登录',
  LOGIN_FAILED: '钉钉登录失败，请稍后重试',
  AUTH_NOT_CONFIGURED: '登录暂未开放',
};

const state = ref(null);
const initialLoading = ref(true);
const loadError = ref('');
const loginOpen = ref(false);
const pendingIds = ref(new Set());
const highlightedId = ref('');
const searchQuery = ref('');
let highlightTimer = null;

const normalizedSearch = computed(() => searchQuery.value.trim().toLowerCase());

const filteredIcons = computed(() => {
  const icons = state.value?.icons ?? [];
  const query = normalizedSearch.value;
  if (!query) return icons;
  return icons.filter(
    (icon) =>
      icon.name.toLowerCase().includes(query) ||
      icon.id.includes(query) ||
      `#${icon.id}`.includes(query),
  );
});

function clearSearch() {
  searchQuery.value = '';
}

onUnmounted(() => {
  if (highlightTimer) clearTimeout(highlightTimer);
});

/**
 * 从实时排行定位到候选卡：滚动到视口中间并短暂高亮。
 * 如果目标被搜索过滤掉，先清空搜索，等卡片渲染后再定位。
 */
async function focusIcon(id) {
  if (!filteredIcons.value.some((icon) => icon.id === id)) {
    searchQuery.value = '';
    await nextTick();
  }
  const card = document.querySelector(`[data-icon-id="${id}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.querySelector('.icon-button')?.focus({ preventScroll: true });
  highlightedId.value = id;
  if (highlightTimer) clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    highlightedId.value = '';
    highlightTimer = null;
  }, 1800);
}

const limitReached = computed(
  () => Boolean(state.value) && state.value.myVotes.length >= state.value.maxVotes,
);

const maxCount = computed(() =>
  Math.max(1, ...(state.value?.icons ?? []).map((icon) => icon.count)),
);

async function fetchState({ silent = false } = {}) {
  try {
    state.value = await api.getState();
    loadError.value = '';
  } catch (error) {
    if (!silent || !state.value) loadError.value = error.message;
    throw error;
  } finally {
    initialLoading.value = false;
  }
}

usePolling(() => fetchState({ silent: true }), 5000);

onMounted(() => {
  const params = new URLSearchParams(window.location.search);
  const errorCode = params.get('auth_error');
  if (!errorCode) return;
  toast.error(AUTH_ERROR_MESSAGES[errorCode] || '登录失败，请重试');
  params.delete('auth_error');
  const query = params.toString();
  const cleanUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', cleanUrl);
});

function openLogin() {
  if (!state.value?.loginConfigured) {
    toast.info('登录暂未开放');
    return;
  }
  loginOpen.value = true;
}

function applySnapshot(snapshot) {
  if (!state.value) return;
  state.value = {
    ...state.value,
    icons: snapshot.icons,
    myVotes: snapshot.myVotes,
    totalVotes: snapshot.totalVotes,
    votersCount: snapshot.votersCount,
    votingOpen: snapshot.votingOpen ?? state.value.votingOpen,
    maxVotes: snapshot.maxVotes ?? state.value.maxVotes,
  };
}

async function toggleIcon(icon) {
  if (!state.value) return;
  if (!state.value.user) {
    openLogin();
    return;
  }
  if (!state.value.votingOpen) {
    toast.error('投票已结束，无法修改投票');
    return;
  }

  const selected = state.value.myVotes.includes(icon.id);
  if (!selected && state.value.myVotes.length >= state.value.maxVotes) {
    toast.error(`最多投 ${state.value.maxVotes} 个图标，请先取消一个`);
    return;
  }
  if (pendingIds.value.has(icon.id)) return;

  pendingIds.value = new Set([...pendingIds.value, icon.id]);
  try {
    const snapshot = selected ? await api.unvote(icon.id) : await api.vote(icon.id);
    applySnapshot(snapshot);
    toast.success(selected ? `已取消「${icon.name}」` : `已投「${icon.name}」`);
  } catch (error) {
    if (error.code === 'VOTING_CLOSED') {
      state.value.votingOpen = false;
      toast.error(error.message);
    } else if (error.status === 401) {
      state.value.user = null;
      state.value.myVotes = [];
      openLogin();
      toast.error('登录已失效，请重新登录');
    } else if (error.code === 'LIMIT_REACHED') {
      toast.error(error.message);
    } else {
      toast.error(error.message);
    }
    fetchState({ silent: true }).catch(() => {});
  } finally {
    const next = new Set(pendingIds.value);
    next.delete(icon.id);
    pendingIds.value = next;
  }
}

async function handleLogout() {
  try {
    await api.logout();
  } catch {
    /* 会话已失效时退出仍然成功 */
  }
  if (state.value) {
    state.value = { ...state.value, user: null, myVotes: [] };
  }
  loginOpen.value = false;
  toast.info('已退出登录');
  fetchState({ silent: true }).catch(() => {});
}
</script>

<template>
  <div class="page">
    <AppHeader
      :user="state?.user ?? null"
      @logout="handleLogout"
    />

    <main class="page-main">
      <section v-if="initialLoading" class="loading-grid" aria-busy="true" aria-label="正在加载候选图标">
        <div v-for="index in 8" :key="index" class="skeleton-card"></div>
      </section>

      <div v-else-if="loadError" class="error-panel" role="alert">
        <h2>加载失败</h2>
        <p>{{ loadError }}</p>
        <button type="button" class="btn btn-primary" @click="fetchState()">重新加载</button>
      </div>

      <template v-else-if="state">
        <section class="hero">
          <div class="hero-copy">
            <p class="eyebrow">Esonitro · 品牌决策</p>
            <h1>选出你心中的 Logo</h1>
          </div>
          <div class="hero-stats" aria-label="投票概况">
            <div class="hero-stat">
              <span class="stat-value" data-testid="total-votes">{{ state.totalVotes }}</span>
              <span class="stat-label">总票数</span>
            </div>
            <div class="hero-stat">
              <span class="stat-value" data-testid="voters-count">{{ state.votersCount }}</span>
              <span class="stat-label">已参与人数</span>
            </div>
          </div>
        </section>

        <div v-if="!state.votingOpen" class="closed-banner" role="status">
          <strong>投票已结束</strong>
        </div>

        <section class="status-bar" aria-label="我的投票状态">
          <span class="status-pill" :class="{ closed: !state.votingOpen }">
            {{ state.votingOpen ? '投票进行中' : '投票已结束' }}
          </span>
          <span class="status-item">
            已投 <strong>{{ state.myVotes.length }}</strong>/{{ state.maxVotes }}
          </span>
        </section>

        <div class="layout">
          <div class="main-column">
            <section class="candidates" aria-labelledby="candidates-title">
              <div class="section-heading candidates-heading">
                <div class="section-title">
                  <h2 id="candidates-title">候选 Logo</h2>
                  <span class="muted">
                    <template v-if="normalizedSearch">
                      {{ filteredIcons.length }} / {{ state.icons.length }} 个匹配
                    </template>
                    <template v-else>{{ state.icons.length }} 个候选</template>
                  </span>
                </div>

                <label class="search-field">
                  <span class="search-glyph" aria-hidden="true">⌕</span>
                  <input
                    v-model="searchQuery"
                    type="search"
                    autocomplete="off"
                    placeholder="搜索名称或编号"
                    aria-label="搜索候选图标"
                    data-testid="icon-search"
                    @keydown.esc="clearSearch"
                  />
                  <button
                    v-if="searchQuery"
                    type="button"
                    class="search-clear"
                    aria-label="清除搜索"
                    data-testid="icon-search-clear"
                    @click="clearSearch"
                  >
                    ×
                  </button>
                </label>
              </div>

              <div v-if="!state.iconsAvailable || !state.icons.length" class="empty-panel">
                <h3>暂无候选图标</h3>
              </div>

              <div
                v-else-if="normalizedSearch && !filteredIcons.length"
                class="empty-panel search-empty"
              >
                <h3>没有匹配的图标</h3>
                <button type="button" class="btn" @click="clearSearch">清除搜索</button>
              </div>

              <div v-else class="icon-grid">
                <IconCard
                  v-for="icon in filteredIcons"
                  :key="icon.id"
                  :icon="icon"
                  :selected="state.myVotes.includes(icon.id)"
                  :pending="pendingIds.has(icon.id)"
                  :voting-open="state.votingOpen"
                  :limit-reached="limitReached"
                  :max-count="maxCount"
                  :highlighted="highlightedId === icon.id"
                  @toggle="toggleIcon"
                />
              </div>
            </section>
          </div>

          <aside class="side-column">
            <VoteSummary
              :icons="state.icons"
              :my-votes="state.myVotes"
              :max-votes="state.maxVotes"
              :voting-open="state.votingOpen"
              :user="state.user"
              @cancel="toggleIcon"
              @login="openLogin"
            />
            <Leaderboard :icons="state.icons" @focus="focusIcon" />
          </aside>
        </div>
      </template>
    </main>

    <LoginDialog :open="loginOpen" @close="loginOpen = false" />
  </div>
</template>
