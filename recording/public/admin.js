'use strict';

/**
 * 管理端逻辑：登录 → 拉取提交列表 → 试听 / 下载。
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

    loginPanel: el('login-panel'),
    loginForm: el('login-form'),
    codeInput: el('code-input'),
    loginSubmit: el('login-submit'),
    loginError: el('login-error'),

    listPanel: el('list-panel'),
    refreshButton: el('refresh-button'),
    logoutButton: el('logout-button'),
    countText: el('count-text'),
    updatedText: el('updated-text'),
    emptyState: el('empty-state'),
    employeeUrl: el('employee-url'),
    tableWrapper: el('table-wrapper'),
    tableBody: el('table-body'),
  };

  const SEGMENT_ORDER = ['zh', 'en'];

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

  function showLoginError(message) {
    setText(dom.loginError, message);
    showElement(dom.loginError, true);
  }

  function clearLoginError() {
    setText(dom.loginError, '');
    showElement(dom.loginError, false);
  }

  function showLogin(reason) {
    showElement(dom.loginPanel, true);
    showElement(dom.listPanel, false);
    if (reason) showLoginError(reason);
    dom.codeInput.focus();
  }

  function showList() {
    showElement(dom.loginPanel, false);
    showElement(dom.listPanel, true);
  }

  function formatTime(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return String(iso);
    return date.toLocaleString('zh-CN', { hour12: false });
  }

  function formatDuration(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return '—';
    return `${value.toFixed(1)} 秒`;
  }

  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '—';
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** 一段录音的单元格：时长 + 试听播放器 + 下载链接。 */
  function buildSegmentCell(segment, label) {
    const cell = document.createElement('td');
    cell.className = 'segment-cell';

    if (!segment) {
      cell.appendChild(document.createTextNode('—'));
      return cell;
    }

    const meta = document.createElement('div');
    meta.className = 'segment-meta';
    meta.textContent = `${label}：${formatDuration(segment.durationSec)}（${formatBytes(segment.bytes)}）`;
    cell.appendChild(meta);

    if (segment.audioUrl) {
      const player = document.createElement('audio');
      player.controls = true;
      player.preload = 'none';
      player.src = segment.audioUrl;
      cell.appendChild(player);
    }

    if (segment.downloadUrl) {
      const link = document.createElement('a');
      link.href = segment.downloadUrl;
      link.textContent = '下载 WAV';
      link.className = 'download-link';
      cell.appendChild(link);
    }

    return cell;
  }

  function buildRow(employee) {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.className = 'name-cell';
    nameCell.textContent = employee.name || '(未填写姓名)';
    row.appendChild(nameCell);

    for (const key of SEGMENT_ORDER) {
      row.appendChild(
        buildSegmentCell(employee.segments ? employee.segments[key] : null, key === 'zh' ? '中文' : '英文')
      );
    }

    const firstCell = document.createElement('td');
    firstCell.textContent = formatTime(employee.firstSubmittedAt);
    row.appendChild(firstCell);

    const updatedCell = document.createElement('td');
    updatedCell.textContent = formatTime(employee.updatedAt);
    row.appendChild(updatedCell);

    return row;
  }

  function renderEmployees(employees) {
    dom.tableBody.textContent = '';
    const list = Array.isArray(employees) ? employees : [];

    setText(dom.countText, `共 ${list.length} 条提交记录`);
    setText(dom.updatedText, `最近刷新：${formatTime(new Date().toISOString())}`);

    if (list.length === 0) {
      showElement(dom.emptyState, true);
      showElement(dom.tableWrapper, false);
      setText(dom.employeeUrl, `${window.location.origin}/`);
      return;
    }

    showElement(dom.emptyState, false);
    showElement(dom.tableWrapper, true);
    for (const employee of list) {
      dom.tableBody.appendChild(buildRow(employee));
    }
  }

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
        showAlert(`加载列表失败（HTTP ${response.status}）。请稍后重试。`);
        return;
      }
      const data = await response.json();
      renderEmployees(data && data.employees);
    } catch (error) {
      showAlert(`无法连接服务端：${error.message}。请检查网络后重试。`);
    } finally {
      dom.refreshButton.disabled = false;
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
        await loadSubmissions();
      } else {
        showLogin();
      }
    } catch (error) {
      showLogin();
      showAlert(`无法连接服务端：${error.message}。请确认服务已经启动。`);
    }
  }

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
    showLogin('已退出登录。');
  });

  checkSession();
})();