'use strict';

/**
 * 员工端逻辑：口令 → 姓名 → 录音 → 提交。
 *
 * 两条关键约束（见 AGENTS.md「本项目特有约束」与 .ai/decisions/004-audio-pipeline.md）：
 *   1. getUserMedia 必须显式关闭 echoCancellation / noiseSuppression / autoGainControl，
 *      浏览器默认开启的这三项会改变音色，直接破坏样本价值；
 *   2. 口令只放在内存里，随提交请求发给服务端校验，不写进 URL、不存 localStorage。
 *
 * 所有错误分支都要给出中文可读提示，不允许静默失败。
 */

(function () {
  // ---------------------------------------------------------------- 常量

  /**
   * 音频采集约束。
   * 这三个开关必须是 false —— 不是性能优化，是样本有效性的前提。
   * 也刻意不设置 channelCount / sampleRate：任何额外约束都可能让浏览器
   * 插入重采样或降混处理，交给服务端的 ffmpeg 统一处理即可。
   */
  const AUDIO_CONSTRAINTS = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };

  /** MediaRecorder 的 mimeType 逐级回退：Chromium 走 webm/opus，Safari 走 mp4。 */
  const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4'];

  /** 计时器刷新间隔，只影响界面数字的跳动频率。 */
  const TIMER_INTERVAL_MS = 200;

  // ---------------------------------------------------------------- DOM

  const el = (id) => document.getElementById(id);

  const dom = {
    envAlert: el('env-alert'),
    globalAlert: el('global-alert'),
    targetSeconds: el('target-seconds'),

    stepCode: el('step-code'),
    codeForm: el('code-form'),
    codeInput: el('code-input'),
    codeSubmit: el('code-submit'),
    codeError: el('code-error'),

    stepName: el('step-name'),
    nameForm: el('name-form'),
    nameInput: el('name-input'),
    nameError: el('name-error'),

    stepRecord: el('step-record'),
    segments: el('segments'),
    submitButton: el('submit-button'),
    submitHint: el('submit-hint'),
    submitError: el('submit-error'),
    progress: el('submit-progress'),
    progressFill: el('progress-fill'),
    progressText: el('progress-text'),

    stepDone: el('step-done'),
    doneMessage: el('done-message'),
    againButton: el('again-button'),
  };

  // ---------------------------------------------------------------- 状态

  const state = {
    config: null,
    code: '',
    name: '',
    /** key -> 段落运行态 */
    segments: new Map(),
    busy: false,
    recorderSupported: typeof window.MediaRecorder !== 'undefined',
    mediaSupported: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  };

  // ---------------------------------------------------------------- 通用 UI

  function showElement(node, visible) {
    if (!node) return;
    node.classList.toggle('hidden', !visible);
  }

  function setText(node, text) {
    if (node) node.textContent = text;
  }

  function showEnvAlert(message) {
    setText(dom.envAlert, message);
    showElement(dom.envAlert, true);
  }

  function showGlobalAlert(message) {
    setText(dom.globalAlert, message);
    showElement(dom.globalAlert, true);
  }

  function clearGlobalAlert() {
    showElement(dom.globalAlert, false);
    setText(dom.globalAlert, '');
  }

  function showFieldError(node, message) {
    setText(node, message);
    showElement(node, true);
  }

  function clearFieldError(node) {
    setText(node, '');
    showElement(node, false);
  }

  function showStep(step) {
    showElement(dom.stepCode, step === 'code');
    showElement(dom.stepName, step === 'name');
    showElement(dom.stepRecord, step === 'record');
    showElement(dom.stepDone, step === 'done');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------------------------------------------------------------- 环境自检

  /**
   * 打开页面先检查环境。这几个条件是浏览器硬性限制，本项目绕不过去，
   * 所以必须提前讲清楚，而不是等用户点了录音再莫名其妙地失败。
   */
  function checkEnvironment() {
    const problems = [];

    if (!window.isSecureContext) {
      problems.push(
        '当前页面不是安全上下文（secure context），浏览器不会允许网页使用麦克风。' +
          '请改用 https:// 或 http://localhost 访问本页面。'
      );
    }
    if (!state.mediaSupported) {
      problems.push(
        '当前浏览器不支持网页录音所需的麦克风接口（navigator.mediaDevices.getUserMedia 不可用）。' +
          '请换用 Chrome / Edge / Safari 的近期版本，并确认是通过 https:// 或 http://localhost 访问。'
      );
    }
    if (!state.recorderSupported) {
      problems.push(
        '当前浏览器不支持录音功能（MediaRecorder 不可用）。' +
          '请换用 Chrome / Edge / Safari 的近期版本再试。'
      );
    }

    if (problems.length > 0) {
      showEnvAlert('无法开始录音：\n' + problems.join('\n'));
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- 配置与渲染

  async function loadConfig() {
    const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`服务端返回 ${response.status}`);
    const config = await response.json();
    if (!config || !Array.isArray(config.segments) || config.segments.length === 0) {
      throw new Error('服务端返回的配置里没有朗读稿');
    }
    state.config = config;
    setText(dom.targetSeconds, String(config.targetSeconds));

    for (const segment of config.segments) {
      state.segments.set(segment.key, {
        key: segment.key,
        label: segment.label,
        lang: segment.lang,
        text: segment.text,
        blob: null,
        url: '',
        seconds: 0,
        recorder: null,
        stream: null,
        chunks: [],
        timerId: null,
        startedAt: 0,
        recording: false,
        discard: false,
        nodes: null,
      });
    }
    renderSegments();
  }

  function renderSegments() {
    dom.segments.textContent = '';
    for (const segment of state.segments.values()) {
      dom.segments.appendChild(buildSegmentCard(segment));
    }
    updateUI();
  }

  function buildSegmentCard(segment) {
    const card = document.createElement('article');
    card.className = 'card segment';
    card.dataset.key = segment.key;

    const head = document.createElement('header');
    head.className = 'segment-head';

    const title = document.createElement('h3');
    title.textContent = segment.lang ? `${segment.label}（${segment.lang}）` : segment.label;
    head.appendChild(title);

    const status = document.createElement('span');
    status.className = 'segment-status';
    status.textContent = '未录音';
    head.appendChild(status);
    card.appendChild(head);

    const passage = document.createElement('p');
    passage.className = 'passage';
    passage.textContent = segment.text;
    card.appendChild(passage);

    const actions = document.createElement('div');
    actions.className = 'segment-actions';

    const recordButton = document.createElement('button');
    recordButton.type = 'button';
    recordButton.className = 'primary';
    recordButton.textContent = '开始录音';
    recordButton.addEventListener('click', () => startRecording(segment.key));
    actions.appendChild(recordButton);

    const stopButton = document.createElement('button');
    stopButton.type = 'button';
    stopButton.textContent = '停止录音';
    stopButton.disabled = true;
    stopButton.addEventListener('click', () => stopRecording(segment.key, false));
    actions.appendChild(stopButton);

    const timer = document.createElement('span');
    timer.className = 'timer';
    timer.textContent = '0.0 / 0 秒';
    actions.appendChild(timer);

    card.appendChild(actions);

    const player = document.createElement('audio');
    player.controls = true;
    player.preload = 'metadata';
    player.className = 'player hidden';
    card.appendChild(player);

    const note = document.createElement('p');
    note.className = 'segment-note hidden';
    card.appendChild(note);

    segment.nodes = { status, recordButton, stopButton, timer, player, note };
    return card;
  }

  // ---------------------------------------------------------------- 录音

  function pickMimeType() {
    if (typeof MediaRecorder.isTypeSupported !== 'function') return '';
    for (const candidate of MIME_CANDIDATES) {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    }
    return '';
  }

  function describeGetUserMediaError(error) {
    const name = error && error.name ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return (
        '麦克风权限被拒绝。请在浏览器的地址栏左侧允许本站使用麦克风，然后重试。\n' +
        '（若页面不是通过 https:// 或 http://localhost 打开的，浏览器会直接拒绝授权。）'
      );
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return '没有检测到可用的麦克风。请插好麦克风或耳机后重试。';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return '麦克风正被其他程序占用，无法读取。请关闭正在使用麦克风的软件后重试。';
    }
    if (name === 'OverconstrainedError') {
      return '当前音频设置下找不到可用的麦克风。请换一个设备后重试。';
    }
    return `无法打开麦克风：${(error && error.message) || name || '未知错误'}。请确认页面是通过 https:// 或 http://localhost 打开的。`;
  }

  function stopStream(segment) {
    if (segment.stream) {
      for (const track of segment.stream.getTracks()) track.stop();
      segment.stream = null;
    }
  }

  function clearSegmentBlob(segment) {
    if (segment.url) {
      URL.revokeObjectURL(segment.url);
      segment.url = '';
    }
    segment.blob = null;
    segment.seconds = 0;
    if (segment.nodes) {
      segment.nodes.player.removeAttribute('src');
      segment.nodes.player.load();
    }
  }

  function isAnyRecording() {
    for (const segment of state.segments.values()) {
      if (segment.recording) return true;
    }
    return false;
  }

  async function startRecording(key) {
    const segment = state.segments.get(key);
    if (!segment || segment.recording || state.busy) return;

    if (!checkEnvironment()) return;
    if (isAnyRecording()) {
      showGlobalAlert('请先停止正在进行的录音，一次只能录一段。');
      return;
    }

    clearGlobalAlert();

    let stream;
    try {
      // 关键：三个音频后处理开关全部显式关闭
      stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
    } catch (error) {
      showGlobalAlert(describeGetUserMediaError(error));
      return;
    }

    const mimeType = pickMimeType();
    let recorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (error) {
      stopStream({ stream });
      showGlobalAlert(`无法创建录音器：${error.message}。请换用 Chrome / Edge / Safari 的近期版本。`);
      return;
    }

    clearSegmentBlob(segment);

    segment.chunks = [];
    segment.recorder = recorder;
    segment.stream = stream;
    segment.recording = true;
    segment.startedAt = Date.now();
    segment.discard = false;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) segment.chunks.push(event.data);
    };

    recorder.onerror = (event) => {
      const error = event && event.error ? event.error : null;
      showGlobalAlert(`录音过程中出错：${(error && error.message) || '未知错误'}。请重试。`);
      segment.discard = true;
      stopRecording(key, true);
    };

    recorder.onstop = () => {
      const elapsed = (Date.now() - segment.startedAt) / 1000;
      stopStream(segment);
      segment.recording = false;
      stopTimer(segment);

      const chunks = segment.chunks;
      segment.chunks = [];

      if (segment.discard) {
        segment.discard = false;
        updateUI();
        return;
      }

      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size === 0) {
        showGlobalAlert('这次录音没有采集到任何声音，请检查麦克风后重录。');
        updateUI();
        return;
      }

      segment.blob = blob;
      segment.url = URL.createObjectURL(blob);
      segment.seconds = elapsed;
      updateUI();
    };

    // 每秒切一个分片，避免长时间录音把所有数据堆在一个巨大的 Blob 里
    recorder.start(1000);
    startTimer(segment);
    updateUI();
  }

  function stopRecording(key, discard) {
    const segment = state.segments.get(key);
    if (!segment || !segment.recorder) return;
    if (discard) segment.discard = true;
    if (segment.recorder.state !== 'inactive') {
      segment.recorder.stop();
    } else {
      segment.recording = false;
      stopTimer(segment);
      stopStream(segment);
      updateUI();
    }
  }

  function startTimer(segment) {
    stopTimer(segment);
    segment.timerId = window.setInterval(() => {
      const elapsed = (Date.now() - segment.startedAt) / 1000;
      renderTimer(segment, elapsed);
      if (state.config && elapsed >= state.config.maxSeconds) {
        // 到达上限自动停止，避免录出超长文件
        stopRecording(segment.key, false);
      }
    }, TIMER_INTERVAL_MS);
  }

  function stopTimer(segment) {
    if (segment.timerId) {
      window.clearInterval(segment.timerId);
      segment.timerId = null;
    }
  }

  function renderTimer(segment, elapsed) {
    if (!segment.nodes) return;
    const max = state.config ? state.config.maxSeconds : 0;
    segment.nodes.timer.textContent = `${elapsed.toFixed(1)} / ${max} 秒`;
  }

  // ---------------------------------------------------------------- 界面刷新

  function updateUI() {
    if (!state.config) return;

    const minSeconds = state.config.minSeconds;
    const problems = [];

    for (const segment of state.segments.values()) {
      const { nodes } = segment;
      if (!nodes) continue;

      if (segment.recording) {
        nodes.status.textContent = '录音中……';
        nodes.status.classList.add('recording');
        nodes.recordButton.disabled = true;
        nodes.recordButton.textContent = '录音中';
        nodes.stopButton.disabled = false;
        nodes.player.classList.add('hidden');
        nodes.note.classList.add('hidden');
      } else {
        nodes.status.classList.remove('recording');
        nodes.stopButton.disabled = true;
        nodes.recordButton.disabled = state.busy;

        if (segment.blob) {
          nodes.status.textContent = `已录制 ${segment.seconds.toFixed(1)} 秒`;
          nodes.recordButton.textContent = '重新录制';
          nodes.player.src = segment.url;
          nodes.player.classList.remove('hidden');
          if (segment.seconds < minSeconds) {
            nodes.note.textContent = `这段录音只有 ${segment.seconds.toFixed(1)} 秒，短于要求的 ${minSeconds} 秒，请重录。`;
            nodes.note.classList.remove('hidden');
            problems.push(`${segment.label}录音太短`);
          } else {
            nodes.note.classList.add('hidden');
          }
        } else {
          nodes.status.textContent = '未录音';
          nodes.recordButton.textContent = '开始录音';
          nodes.player.classList.add('hidden');
          nodes.note.textContent = `请朗读这段文字，录满 ${state.config.targetSeconds} 秒左右。`;
          nodes.note.classList.remove('hidden');
          problems.push(`${segment.label}还没有录音`);
        }
      }

      if (!segment.recording) {
        renderTimer(segment, segment.blob ? segment.seconds : 0);
      }
    }

    const canSubmit = !state.busy && !isAnyRecording() && problems.length === 0;
    dom.submitButton.disabled = !canSubmit;
    dom.submitButton.textContent = state.busy ? '正在提交……' : '提交录音';

    if (state.busy) {
      setText(dom.submitHint, '正在上传，请勿关闭页面。');
    } else if (problems.length === 0) {
      setText(dom.submitHint, `两段都录好了，可以提交。提交后如需修改，可以再次录制并提交，会覆盖上一次的录音。`);
    } else {
      setText(dom.submitHint, `还需要：${problems.join('、')}。`);
    }
  }

  // ---------------------------------------------------------------- 提交

  function blobFileName(segment) {
    const type = segment.blob && segment.blob.type ? segment.blob.type : '';
    const extension = type.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
    return `${segment.key}.${extension}`;
  }

  function messageFromResponse(data, status) {
    if (data && typeof data.error === 'string' && data.error) return data.error;
    if (status === 413) return '音频文件太大，请缩短录音时间后重试。';
    if (status === 500) return '服务端处理失败，请稍后重试。';
    return `提交失败（HTTP ${status}）。`;
  }

  async function submitRecordings() {
    if (state.busy) return;

    const form = new FormData();
    form.append('code', state.code);
    form.append('name', state.name);
    for (const segment of state.segments.values()) {
      form.append(segment.key, segment.blob, blobFileName(segment));
    }

    state.busy = true;
    clearFieldError(dom.submitError);
    showElement(dom.progress, true);
    dom.progressFill.style.width = '15%';
    setText(dom.progressText, '正在上传两段录音……');
    updateUI();

    try {
      const response = await fetch('/api/submit', { method: 'POST', body: form });
      dom.progressFill.style.width = '80%';

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (response.ok && data && data.ok) {
        dom.progressFill.style.width = '100%';
        setText(dom.progressText, '提交完成。');
        showDone(data.name || state.name);
        return;
      }

      if (response.status === 401) {
        // 口令失效：退回第一步，姓名保留，两段录音也保留，不用重录
        state.code = '';
        showStep('code');
        dom.codeInput.value = '';
        showFieldError(dom.codeError, '口令不正确或已失效，请重新输入口令。');
        return;
      }

      showFieldError(dom.submitError, messageFromResponse(data, response.status));
    } catch (error) {
      showFieldError(dom.submitError, `网络错误，提交失败：${error.message}。请检查网络后重试。`);
    } finally {
      state.busy = false;
      showElement(dom.progress, false);
      dom.progressFill.style.width = '0';
      updateUI();
    }
  }

  function showDone(name) {
    setText(
      dom.doneMessage,
      `已收到「${name}」的录音，感谢配合！如果发现读错了，可以点下面的按钮重新录制并再次提交，新录音会覆盖这一次的。`
    );
    showStep('done');
  }

  function resetSegments() {
    for (const segment of state.segments.values()) {
      stopTimer(segment);
      stopStream(segment);
      clearSegmentBlob(segment);
      segment.recording = false;
      segment.chunks = [];
      segment.recorder = null;
    }
    clearFieldError(dom.submitError);
    clearGlobalAlert();
    updateUI();
  }

  // ---------------------------------------------------------------- 事件绑定

  dom.codeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = dom.codeInput.value;
    if (!code) {
      showFieldError(dom.codeError, '请输入员工口令。');
      return;
    }

    dom.codeSubmit.disabled = true;
    clearFieldError(dom.codeError);
    try {
      const response = await fetch('/api/employee/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (response.ok) {
        state.code = code;
        showStep('name');
        dom.nameInput.focus();
        return;
      }
      if (response.status === 401) {
        showFieldError(dom.codeError, '口令不正确，请向管理员确认后重试。');
        return;
      }
      showFieldError(dom.codeError, `服务端返回 ${response.status}，请稍后重试。`);
    } catch (error) {
      showFieldError(dom.codeError, `无法连接服务端：${error.message}。请检查网络后重试。`);
    } finally {
      dom.codeSubmit.disabled = false;
    }
  });

  dom.nameForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = dom.nameInput.value.trim();
    if (!name) {
      showFieldError(dom.nameError, '请填写姓名。');
      return;
    }
    clearFieldError(dom.nameError);
    state.name = name;
    showStep('record');
  });

  dom.submitButton.addEventListener('click', submitRecordings);

  dom.againButton.addEventListener('click', () => {
    resetSegments();
    showStep('record');
  });

  window.addEventListener('beforeunload', (event) => {
    if (isAnyRecording()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  // ---------------------------------------------------------------- 启动

  (async function init() {
    const environmentOk = checkEnvironment();
    try {
      await loadConfig();
    } catch (error) {
      showEnvAlert(`加载配置失败：${error.message}。请刷新页面重试，或联系管理员。`);
      return;
    }

    if (state.config.segments.length === 0) {
      showEnvAlert('服务端没有配置任何朗读段落，请联系管理员。');
      return;
    }

    if (environmentOk) {
      showStep('code');
      dom.codeInput.focus();
    } else {
      // 环境不满足时仍然显示页面，但把第一步挡住，避免用户白填一遍
      showStep('code');
    }
  })();
})();