'use strict';

/**
 * 管理端逻辑：登录 → 拉取提交列表 → 搜索 / 排序 / 试听 / 下载。
 *
 * 会话靠服务端下发的 httpOnly cookie 维持，前端脚本读不到 token，
 * 也不需要自己保存任何凭据。接口返回 401 就自动退回登录态。
 *
 * 所有来自员工输入的内容（姓名）一律用 textContent 写入，绝不拼 HTML 字符串，
 * 避免姓名里带标签时在管理端页面上被执行。
 */

(function () {
  const el = (id) => document.getElementById(id);

  const dom = {
    globalAlert: el('global-alert'),
    globalNotice: el('global-notice'),

    loginPanel: el('login-panel'),
    loginForm: el('login-form'),
    codeInput: el('code-input'),
    loginSubmit: el('login-submit'),
    loginError: el('login-error'),

    listPanel: el('list-panel'),
    searchInput: el('search-input'),
    sortSelect: el('sort-select'),
    autoRefresh: el('auto-refresh'),
    copyUrlButton: el('copy-url-button'),
    refreshButton: el('refresh-button'),
    logoutButton: el('logout-button'),
    countText: el('count-text'),
    updatedText: el('updated-text'),
    emptyState: el('empty-state'),
    employeeUrl: el('employee-url'),
    copyUrlEmpty: el('copy-url-empty'),
    emptyFilter: el('empty-filter'),
    emptyFilterText: el('empty-filter-text'),
    clearSearchButton: el('clear-search-button'),
    tableWrapper: el('table-wrapper'),
    tableBody: el('table-body'),
  };

  const SEGMENT_ORDER = ['zh', 'en'];

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** 引用页面内联图标集里的一枚图标。 */
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#${name}`);
    svg.appendChild(use);
    return svg;
  }

  function textNode(text) {
    return document.createTextNode(text);
  }
  /** 自动刷新间隔。单管理员使用，30 秒足够，且可随时关闭。 */
  const REFRESH_INTERVAL_MS = 30 * 1000;
  /** 相对时间的自动刷新间隔。 */
  const TIME_REFRESH_MS = 30 * 1000;
  const TICK_MS = 1000;

  const state = {
    employees: [],
    /** 用于"偏短"标记的阈值，来自公开配置接口；取不到就不标记。 */
    minSeconds: 0,
    thresholdsLoaded: false,
    loggedIn: false,
    autoRefresh: true,
    searchTerm: '',
    sortKey: 'updated-desc',
    lastRefreshAt: 0,
    nextRefreshAt: 0,
    tickId: null,
    lastTimeRefreshAt: 0,
    noticeTimerId: null,
  };

  function showElement(node, visible) {
    if (node) node.classList.toggle('hidden', !visible);
  }

  function setText(node, text) {
    if (node) node.textContent = text;
  }

  function showAlert(message) {
    setText(dom.globalAlert, message);
    showElement(dom.globalAlert, true);
  }

  function clearAlert() {
    setText(dom.globalAlert, '');
    showElement(dom.globalAlert, false);
  }

  function showNotice(message) {
    if (state.noticeTimerId) window.clearTimeout(state.noticeTimerId);
    setText(dom.globalNotice, message);
    showElement(dom.globalNotice, true);
    state.noticeTimerId = window.setTimeout(() => clearNotice(), 3000);
  }

  function clearNotice() {
    if (state.noticeTimerId) {
      window.clearTimeout(state.noticeTimerId);
      state.noticeTimerId = null;
    }
    setText(dom.globalNotice, '');
    showElement(dom.globalNotice, false);
  }

  function showLoginError(message) {
    setText(dom.loginError, message);
    showElement(dom.loginError, true);
  }

  function clearLoginError() {
    setText(dom.loginError, '');
    showElement(dom.loginError, false);
  }

  function showLogin(reason) {
    stopTicking();
    state.loggedIn = false;
    showElement(dom.loginPanel, true);
    showElement(dom.listPanel, false);
    if (reason) showLoginError(reason);
    dom.codeInput.focus();
  }

  function showList() {
    state.loggedIn = true;
    showElement(dom.loginPanel, false);
    showElement(dom.listPanel, true);
    setText(dom.employeeUrl, `${window.location.origin}/`);
    startTicking();
  }

  // ---------------------------------------------------------------- 时间与格式

  function formatTime(iso) {
    const timestamp = Date.parse(iso);
    if (!Number.isFinite(timestamp)) return '—';
    return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
  }

  function formatRelative(iso) {
    const timestamp = Date.parse(iso);
    if (!Number.isFinite(timestamp)) return '—';
    return formatRelativeFromMs(Date.now() - timestamp);
  }

  function formatRelativeFromMs(diff) {
    if (!Number.isFinite(diff) || diff < 0) return '刚刚';
    if (diff < 45 * 1000) return '刚刚';
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} 天前`;
    return formatTime(new Date(Date.now() - diff).toISOString());
  }

  /**
   * 录音时长统一格式化为 m:ss.s（如 1:02.4）；compact 时省略十分位。
   * 无效或非正数返回「—」。
   */
  function formatClock(seconds, { compact = false } = {}) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return '—';
    const totalTenths = Math.round(value * 10);
    const tenths = totalTenths % 10;
    const totalSeconds = Math.floor(totalTenths / 10);
    const minutes = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    const head = `${minutes}:${String(secs).padStart(2, '0')}`;
    return compact ? head : `${head}.${tenths}`;
  }

  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '—';
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * 一段录音的单元格：时长信息 + 精简播放器 + 下载图标。
   * 播放器用原生 button / input[type=range] 组装（不引依赖），键盘可达。
   */
  function buildSegmentCell(segment, label, employeeName) {
    const cell = document.createElement('td');
    cell.className = 'col-audio';

    if (!segment) {
      cell.appendChild(document.createTextNode('—'));
      return cell;
    }

    const meta = document.createElement('div');
    meta.className = 'audio-meta';
    meta.appendChild(textNode(`${formatClock(segment.durationSec)} · ${formatBytes(segment.bytes)}`));

    if (state.minSeconds > 0 && Number(segment.durationSec) > 0 && Number(segment.durationSec) < state.minSeconds) {
      const badge = document.createElement('span');
      badge.className = 'chip is-warn';
      badge.textContent = '偏短';
      badge.title = `短于要求的 ${state.minSeconds} 秒`;
      meta.appendChild(badge);
    }
    cell.appendChild(meta);

    const row = document.createElement('div');
    row.className = 'audio-row';

    const playButton = document.createElement('button');
    playButton.type = 'button';
    playButton.className = 'play-btn';
    const setPlayLabel = (playing) => {
      playButton.setAttribute('aria-label', `${playing ? '暂停' : '播放'} ${employeeName} 的${label}录音`);
      playButton.title = playing ? '暂停' : '播放';
    };
    setPlayLabel(false);
    const playIcon = icon('i-play');
    playIcon.classList.add('icon-play');
    const pauseIcon = icon('i-pause');
    pauseIcon.classList.add('icon-pause');
    playButton.append(playIcon, pauseIcon);

    const track = document.createElement('div');
    track.className = 'track';

    const seek = document.createElement('input');
    seek.type = 'range';
    seek.className = 'seek';
    seek.min = '0';
    seek.max = '1000';
    seek.step = '1';
    seek.value = '0';
    seek.setAttribute('aria-label', `${employeeName} 的${label}录音播放进度`);

    const times = document.createElement('span');
    times.className = 'times';
    const elapsedText = document.createElement('span');
    elapsedText.className = 'elapsed';
    elapsedText.textContent = '0:00';
    const durationText = document.createElement('span');
    durationText.className = 'duration';
    durationText.textContent = formatClock(segment.durationSec).replace(/\.\d$/, '');
    times.append(elapsedText, textNode(' / '), durationText);

    track.append(seek, times);

    const download = document.createElement('a');
    download.className = 'icon-btn';
    download.href = segment.downloadUrl;
    download.title = '下载 WAV';
    download.setAttribute('aria-label', `下载 ${employeeName} 的${label}录音`);
    download.appendChild(icon('i-download'));

    row.append(playButton, track, download);
    cell.appendChild(row);

    const audio = document.createElement('audio');
    audio.preload = 'none';
    audio.src = segment.audioUrl;
    audio.className = 'audio-engine';
    cell.appendChild(audio);

    const currentDuration = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
      const fallback = Number(segment.durationSec);
      return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
    };

    playButton.addEventListener('click', () => {
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
    });

    seek.addEventListener('input', () => {
      seek.dataset.seeking = '1';
      const duration = currentDuration();
      if (duration > 0) {
        const target = (Number(seek.value) / 1000) * duration;
        try {
          audio.currentTime = target;
        } catch {
          // 元数据还没就绪时忽略，等 loadedmetadata 后重试
        }
        elapsedText.textContent = formatClock(target, { compact: true });
      }
    });

    seek.addEventListener('change', () => {
      delete seek.dataset.seeking;
    });

    audio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        durationText.textContent = formatClock(audio.duration, { compact: true });
      }
    });

    audio.addEventListener('timeupdate', () => {
      const duration = currentDuration();
      if (!seek.dataset.seeking && duration > 0) {
        seek.value = String(Math.round((audio.currentTime / duration) * 1000));
      }
      elapsedText.textContent = formatClock(audio.currentTime, { compact: true });
    });

    audio.addEventListener('play', () => {
      playButton.classList.add('is-playing');
      setPlayLabel(true);
    });

    audio.addEventListener('pause', () => {
      playButton.classList.remove('is-playing');
      setPlayLabel(false);
    });

    audio.addEventListener('ended', () => {
      playButton.classList.remove('is-playing');
      setPlayLabel(false);
      seek.value = '0';
      elapsedText.textContent = '0:00';
    });

    return cell;
  }

  function buildTimeCell(iso) {
    const cell = document.createElement('td');
    cell.className = 'col-time';
    const time = document.createElement('time');
    time.className = 'time';
    time.dateTime = iso || '';
    time.dataset.iso = iso || '';
    time.title = formatTime(iso);
    time.textContent = formatRelative(iso);
    cell.appendChild(time);
    return cell;
  }

  function buildRow(employee) {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.className = 'name-cell';
    nameCell.textContent = employee.name || '(未填写姓名)';
    nameCell.title = employee.name || '';
    row.appendChild(nameCell);

    for (const key of SEGMENT_ORDER) {
      row.appendChild(
        buildSegmentCell(
          employee.segments ? employee.segments[key] : null,
          key === 'zh' ? '中文' : '英文',
          employee.name || '(未填写姓名)'
        )
      );
    }

    row.appendChild(buildTimeCell(employee.firstSubmittedAt));
    row.appendChild(buildTimeCell(employee.updatedAt));
    return row;
  }

  // ---------------------------------------------------------------- 过滤、排序与渲染

  function sortEmployees(list) {
    const sorted = list.slice();
    if (state.sortKey === 'name-asc') {
      sorted.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
    } else if (state.sortKey === 'first-desc') {
      sorted.sort((a, b) => String(b.firstSubmittedAt || '').localeCompare(String(a.firstSubmittedAt || '')));
    } else {
      sorted.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    }
    return sorted;
  }

  function getVisibleEmployees() {
    const term = state.searchTerm.toLowerCase();
    const filtered = term
      ? state.employees.filter((employee) => String(employee.name || '').toLowerCase().includes(term))
      : state.employees;
    return sortEmployees(filtered);
  }

  function renderList() {
    const total = state.employees.length;

    if (state.searchTerm && total > 0) {
      setText(dom.countText, `显示 ${getVisibleEmployees().length} / 共 ${total} 条提交记录`);
    } else {
      setText(dom.countText, `共 ${total} 条提交记录`);
    }

    if (total === 0) {
      showElement(dom.emptyState, true);
      showElement(dom.emptyFilter, false);
      showElement(dom.tableWrapper, false);
      return;
    }

    const list = getVisibleEmployees();
    if (list.length === 0) {
      showElement(dom.emptyState, false);
      showElement(dom.emptyFilter, true);
      setText(dom.emptyFilterText, `没有匹配「${state.searchTerm}」的记录。`);
      showElement(dom.tableWrapper, false);
      return;
    }

    showElement(dom.emptyState, false);
    showElement(dom.emptyFilter, false);
    showElement(dom.tableWrapper, true);

    const fragment = document.createDocumentFragment();
    for (const employee of list) fragment.appendChild(buildRow(employee));
    dom.tableBody.textContent = '';
    dom.tableBody.appendChild(fragment);
  }

  function updateTimes() {
    for (const time of document.querySelectorAll('time[data-iso]')) {
      time.textContent = formatRelative(time.dataset.iso);
    }
    state.lastTimeRefreshAt = Date.now();
  }

  function updateStatusLine() {
    if (!state.lastRefreshAt) {
      setText(dom.updatedText, '正在加载……');
      return;
    }
    const refreshed = `最近刷新：${formatRelativeFromMs(Date.now() - state.lastRefreshAt)}`;
    if (!state.autoRefresh) {
      setText(dom.updatedText, `${refreshed} · 自动刷新已关闭`);
      return;
    }
    const secondsLeft = Math.max(0, Math.ceil((state.nextRefreshAt - Date.now()) / 1000));
    setText(dom.updatedText, `${refreshed} · 自动刷新：${secondsLeft} 秒后`);
  }

  // ---------------------------------------------------------------- 自动刷新

  function startTicking() {
    stopTicking();
    scheduleNextRefresh();
    state.tickId = window.setInterval(tick, TICK_MS);
    updateStatusLine();
  }

  function stopTicking() {
    if (state.tickId) {
      window.clearInterval(state.tickId);
      state.tickId = null;
    }
  }

  function scheduleNextRefresh() {
    state.nextRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
  }

  function tick() {
    updateStatusLine();
    if (Date.now() - state.lastTimeRefreshAt >= TIME_REFRESH_MS) updateTimes();
    if (!state.loggedIn || !state.autoRefresh) return;
    if (document.hidden) return;
    if (Date.now() >= state.nextRefreshAt) loadSubmissions();
  }

  // ---------------------------------------------------------------- 数据加载

  async function loadSubmissions() {
    dom.refreshButton.disabled = true;
    clearAlert();
    try {
      const response = await fetch('/api/admin/submissions', {
        headers: { Accept: 'application/json' },
      });
      if (response.status === 401) {
        showLogin('会话已过期，请重新登录。');
        return;
      }
      if (!response.ok) {
        // 刷新失败不清空已有列表
        showAlert(`加载列表失败（HTTP ${response.status}）。请稍后重试。`);
        return;
      }
      const data = await response.json();
      state.employees = Array.isArray(data && data.employees) ? data.employees : [];
      state.lastRefreshAt = Date.now();
      state.lastTimeRefreshAt = Date.now();
      renderList();
    } catch (error) {
      showAlert(`无法连接服务端：${error.message}。请检查网络后重试。`);
    } finally {
      dom.refreshButton.disabled = false;
      scheduleNextRefresh();
      updateStatusLine();
    }
  }

  async function loadThresholds() {
    if (state.thresholdsLoaded) return;
    try {
      const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const config = await response.json();
      state.minSeconds = Number(config && config.minSeconds) || 0;
      state.thresholdsLoaded = true;
      renderList();
    } catch {
      // 拿不到阈值就不做"偏短"标记，不阻塞列表
    }
  }

  async function checkSession() {
    try {
      const response = await fetch('/api/admin/session', { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        showLogin();
        return;
      }
      const data = await response.json();
      if (data && data.authenticated) {
        showList();
        void loadThresholds();
        await loadSubmissions();
      } else {
        showLogin();
      }
    } catch (error) {
      showLogin();
      showAlert(`无法连接服务端：${error.message}。请确认服务已经启动。`);
    }
  }

  // ---------------------------------------------------------------- 复制入口地址

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // 继续走下面的回退方案
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }

  async function copyEmployeeUrl() {
    const url = `${window.location.origin}/`;
    const ok = await copyText(url);
    if (ok) {
      showNotice(`已复制员工入口：${url}`);
    } else {
      showAlert(`复制失败，请手动复制员工入口：${url}`);
    }
  }

  // ---------------------------------------------------------------- 事件绑定

  dom.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = dom.codeInput.value;
    if (!code) {
      showLoginError('请输入管理端口令。');
      return;
    }

    dom.loginSubmit.disabled = true;
    clearLoginError();
    clearAlert();
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (response.ok) {
        dom.codeInput.value = '';
        showList();
        void loadThresholds();
        await loadSubmissions();
        return;
      }
      if (response.status === 401) {
        showLoginError('口令不正确，请重试。');
        return;
      }
      showLoginError(`登录失败（HTTP ${response.status}）。请稍后重试。`);
    } catch (error) {
      showLoginError(`无法连接服务端：${error.message}。`);
    } finally {
      dom.loginSubmit.disabled = false;
    }
  });

  dom.refreshButton.addEventListener('click', loadSubmissions);

  dom.logoutButton.addEventListener('click', async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch {
      // 退出失败也无所谓，前端照样回到登录态
    }
    state.employees = [];
    showLogin('已退出登录。');
  });

  dom.searchInput.addEventListener('input', () => {
    state.searchTerm = dom.searchInput.value.trim();
    renderList();
  });

  dom.clearSearchButton.addEventListener('click', () => {
    dom.searchInput.value = '';
    state.searchTerm = '';
    renderList();
  });

  dom.sortSelect.addEventListener('change', () => {
    state.sortKey = dom.sortSelect.value;
    renderList();
  });

  dom.autoRefresh.addEventListener('change', () => {
    state.autoRefresh = dom.autoRefresh.checked;
    scheduleNextRefresh();
    updateStatusLine();
  });

  dom.copyUrlButton.addEventListener('click', copyEmployeeUrl);
  dom.copyUrlEmpty.addEventListener('click', copyEmployeeUrl);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.loggedIn && state.autoRefresh) {
      loadSubmissions();
    }
  });

  // 试听互斥：开始播放某段时，暂停其他正在播放的播放器
  document.addEventListener(
    'play',
    (event) => {
      const target = event.target;
      if (!target || target.tagName !== 'AUDIO') return;
      for (const audio of document.querySelectorAll('audio')) {
        if (audio !== target && !audio.paused) audio.pause();
      }
    },
    true
  );

  checkSession();
})();