export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', body, rawBody, headers = {} } = {}) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...headers,
    },
  };
  if (rawBody !== undefined) {
    options.body = rawBody;
  } else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '网络连接失败，请检查网络后重试');
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      data?.error || `HTTP_${response.status}`,
      data?.message || `请求失败（HTTP ${response.status}）`,
    );
  }
  return data;
}

export const api = {
  getState: () => request('/api/state'),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  vote: (iconId) => request(`/api/votes/${encodeURIComponent(iconId)}`, { method: 'PUT' }),
  unvote: (iconId) => request(`/api/votes/${encodeURIComponent(iconId)}`, { method: 'DELETE' }),
  adminLogin: (password) => request('/api/admin/login', { method: 'POST', body: { password } }),
  adminLogout: () => request('/api/admin/logout', { method: 'POST' }),
  getAdminState: () => request('/api/admin/state'),
  getVoters: () => request('/api/admin/voters'),
  uploadIcon: (file) =>
    request(`/api/admin/icons?filename=${encodeURIComponent(file.name || '')}`, {
      method: 'POST',
      rawBody: file,
      headers: { 'Content-Type': 'image/png' },
    }),
  setVotingOpen: (votingOpen) =>
    request('/api/admin/settings', { method: 'PUT', body: { votingOpen } }),
  getDingTalkSettings: () => request('/api/admin/dingtalk'),
  saveDingTalkSettings: (settings) =>
    request('/api/admin/dingtalk', { method: 'PUT', body: settings }),
  resetVotes: (confirm) => request('/api/admin/reset', { method: 'POST', body: { confirm } }),
  exportUrl: '/api/admin/export.csv',
};
