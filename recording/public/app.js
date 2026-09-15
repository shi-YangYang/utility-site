'use strict';

/**
 * 员工端逻辑：口令 → 姓名 → 录音 → 提交。
 *
 * 三条关键约束（见 AGENTS.md「本项目特有约束」与 .ai/decisions/004-audio-pipeline.md）：
 *   1. getUserMedia 必须显式关闭 echoCancellation / noiseSuppression / autoGainControl，
 *      浏览器默认开启的这三项会改变音色，直接破坏样本价值；
 *   2. 口令只放在内存里，随提交请求发给服务端校验，不写进 URL、不存 localStorage；
 *   3. 电平表用的是只读 AnalyserNode，不参与录制、不改变任何音频约束。
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

  /** 姓名的本机记忆键。口令绝不写入这里。 */
  const NAME_STORAGE_KEY = 'recording.lastName';

  /** 判定"接近静音"的 RMS 阈值，以及需要持续多久才提示。 */
  const SILENCE_RMS = 0.01;
  const SILENCE_HOLD_MS = 3000;

  /** 电平条显示的放大系数（RMS 通常很小，放大后才看得见）。 */
  const LEVEL_SCALE = 4;

  /** 读取产物实际时长的超时；读不到就回退到过程耗时估算。 */
  const DURATION_READ_TIMEOUT_MS = 4000;

  // ---------------------------------------------------------------- DOM

  const el = (id) => document.getElementById(id);

  const dom = {
    envAlert: el('env-alert'),
    globalAlert: el('global-alert'),
    announcer: el('sr-announcer'),
    targetSeconds: el('target-seconds'),
    stepNav: el('step-nav'),
    stepItems: Array.from(document.querySelectorAll('#step-nav .step-item')),

    stepCode: el('step-code'),
    codeHeading: el('code-heading'),
    codeForm: el('code-form'),
    codeInput: el('code-input'),
    codeSubmit: el('code-submit'),
    codeError: el('code-error'),

    stepName: el('step-name'),
    nameHeading: el('name-heading'),
    nameForm: el('name-form'),
    nameInput: el('name-input'),
    nameSubmit: el('name-submit'),
    nameError: el('name-error'),

    stepRecord: el('step-record'),
    recordHeading: el('record-heading'),
    editNameButton: el('edit-name-button'),
    segments: el('segments'),
    submitButton: el('submit-button'),
    cancelUploadButton: el('cancel-upload-button'),
    submitHint: el('submit-hint'),
    submitNotice: el('submit-notice'),
    submitError: el('submit-error'),
    progress: el('submit-progress'),
    progressBar: el('progress-bar'),
    progressFill: el('progress-fill'),
    progressText: el('progress-text'),

    stepDone: el('step-done'),
    doneHeading: el('done-heading'),
    doneMessage: el('done-message'),
    doneSummary: el('done-summary'),
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
    /** 是否正在等待 getUserMedia 返回（授权弹窗/慢设备的窗口期）。 */
    starting: false,
    /** 上一次提交是否失败（失败后按钮显示"重试提交"）。 */
    submitFailed: false,
    /** 是否已经成功提交过（成功后离开页面不再拦截）。 */
    submitSucceeded: false,
    xhr: null,
    recorderSupported: typeof window.MediaRecorder !== 'undefined',
    mediaSupported: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  };

  const STEP_ORDER = ['code', 'name', 'record'];

  function stepHeading(step) {
    if (step === 'code') return dom.codeHeading;
    if (step === 'name') return dom.nameHeading;
    if (step === 'record') return dom.recordHeading;
    if (step === 'done') return dom.doneHeading;
    return null;
  }

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

  function showNotice(node, message) {
    setText(node, message);
    showElement(node, true);
  }

  function clearNotice(node) {
    setText(node, '');
    showElement(node, false);
  }

  /** 屏幕阅读器播报：只播报关键节点，避免计时数字刷屏。 */
  function announce(message) {
    if (!dom.announcer) return;
    dom.announcer.textContent = message;
  }

  function formatSeconds(value) {
    return `${Number(value).toFixed(1)} 秒`;
  }

  /** 切换步骤：更新指示器、移动焦点（焦点落在该步标题上）。 */
  function showStep(step, { focus = true } = {}) {
    showElement(dom.stepCode, step === 'code');
    showElement(dom.stepName, step === 'name');
    showElement(dom.stepRecord, step === 'record');
    showElement(dom.stepDone, step === 'done');
    setStepNav(step);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (focus) {
      const heading = stepHeading(step);
      if (heading) heading.focus({ preventScroll: true });
    }
  }

  function setStepNav(step) {
    const currentIndex = STEP_ORDER.indexOf(step);
    const allDone = step === 'done';
    for (const item of dom.stepItems) {
      const index = STEP_ORDER.indexOf(item.dataset.step);
      const isCurrent = !allDone && index === currentIndex;
      const isDone = allDone || (currentIndex >= 0 && index < currentIndex);
      item.classList.toggle('is-current', isCurrent);
      item.classList.toggle('is-done', isDone);
      if (isCurrent) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    }
  }

  // ---------------------------------------------------------------- 姓名记忆

  function readStoredName() {
    try {
      return window.localStorage.getItem(NAME_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  }

  function storeName(name) {
    try {
      window.localStorage.setItem(NAME_STORAGE_KEY, name);
    } catch {
      // localStorage 不可用（隐私模式等）时静默降级，不影响流程
    }
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
        pending: false,
        discard: false,
        autoStopped: false,
        targetAnnounced: false,
        silenceWarned: false,
        meter: null,
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
    const config = state.config;
    const max = config.maxSeconds;
    const percent = (value) => `${Math.max(0, Math.min(100, (value / max) * 100)).toFixed(2)}%`;

    const card = document.createElement('article');
    card.className = 'card segment';
    card.dataset.key = segment.key;

    const head = document.createElement('header');
    head.className = 'segment-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'segment-title';

    const title = document.createElement('h3');
    title.textContent = segment.lang ? `${segment.label}（${segment.lang}）` : segment.label;
    titleWrap.appendChild(title);

    const status = document.createElement('span');
    status.className = 'segment-status';
    status.textContent = '未录音';
    titleWrap.appendChild(status);
    head.appendChild(titleWrap);

    const target = document.createElement('p');
    target.className = 'segment-target hint';
    target.textContent = `目标约 ${config.targetSeconds} 秒 · 最少 ${config.minSeconds} 秒 · 最长 ${max} 秒`;
    head.appendChild(target);

    card.appendChild(head);

    const passage = document.createElement('p');
    passage.className = 'passage';
    passage.textContent = segment.text;
    card.appendChild(passage);

    const progressWrap = document.createElement('div');
    progressWrap.className = 'record-progress hidden';

    const bar = document.createElement('div');
    bar.className = 'record-bar';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', `${segment.label}录音进度`);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(max));

    const fill = document.createElement('div');
    fill.className = 'record-fill';
    bar.appendChild(fill);

    const tickMin = document.createElement('span');
    tickMin.className = 'record-tick';
    tickMin.style.left = `calc(${percent(config.minSeconds)} - 1px)`;
    tickMin.setAttribute('aria-hidden', 'true');
    bar.appendChild(tickMin);

    const tickTarget = document.createElement('span');
    tickTarget.className = 'record-tick is-target';
    tickTarget.style.left = `calc(${percent(config.targetSeconds)} - 1px)`;
    tickTarget.setAttribute('aria-hidden', 'true');
    bar.appendChild(tickTarget);

    const progressText = document.createElement('p');
    progressText.className = 'record-progress-text hint';

    progressWrap.appendChild(bar);
    progressWrap.appendChild(progressText);
    card.appendChild(progressWrap);

    const levelWrap = document.createElement('div');
    levelWrap.className = 'level-meter hidden';
    levelWrap.setAttribute('aria-hidden', 'true');

    const levelLabel = document.createElement('span');
    levelLabel.className = 'level-label';
    levelLabel.textContent = '输入电平';

    const levelBar = document.createElement('div');
    levelBar.className = 'level-bar';

    const levelFill = document.createElement('div');
    levelFill.className = 'level-fill';
    levelBar.appendChild(levelFill);

    levelWrap.appendChild(levelLabel);
    levelWrap.appendChild(levelBar);
    card.appendChild(levelWrap);

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
    timer.setAttribute('aria-hidden', 'true');
    timer.textContent = '0.0 秒';
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

    const liveNote = document.createElement('p');
    liveNote.className = 'segment-note is-warn hidden';
    liveNote.setAttribute('role', 'status');
    card.appendChild(liveNote);

    segment.nodes = {
      card,
      status,
      target,
      recordButton,
      stopButton,
      timer,
      player,
      note,
      liveNote,
      progressWrap,
      progressBar: bar,
      progressFill: fill,
      progressText,
      levelWrap,
      levelFill,
    };
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
    segment.targetAnnounced = false;
    segment.silenceWarned = false;
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
    if (!segment || segment.recording || state.busy || state.starting) return;

    if (!checkEnvironment()) return;
    if (isAnyRecording()) {
      showGlobalAlert('请先停止正在进行的录音，一次只能录一段。');
      return;
    }

    clearGlobalAlert();

    // 授权弹窗 / 慢设备会让 getUserMedia 等待一段时间。
    // 必须同步置位 starting 并立刻刷新界面，否则等待窗口内按钮看起来仍空闲，
    // 连点或先后点两段就会启动两个录音器。
    state.starting = true;
    segment.pending = true;
    updateUI();

    let stream = null;
    let handedOff = false;

    try {
      try {
        // 关键：三个音频后处理开关全部显式关闭
        stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
      } catch (error) {
        const message = describeGetUserMediaError(error);
        showGlobalAlert(message);
        announce(`无法开始录音：${message.split('\n')[0]}`);
        return;
      }

      // 等待期间若有其他入口启动了录音，放弃这一次，并立即释放刚拿到的流
      if (segment.recording || isAnyRecording()) {
        stopStream({ stream });
        announce('已有另一段在录音，本次没有开始');
        return;
      }

      const mimeType = pickMimeType();
      let recorder;
      try {
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch (error) {
        const message = `无法创建录音器：${error.message}。请换用 Chrome / Edge / Safari 的近期版本。`;
        showGlobalAlert(message);
        announce(message);
        return;
      }

      clearSegmentBlob(segment);

      segment.chunks = [];
      segment.recorder = recorder;
      segment.stream = stream;
      segment.recording = true;
      segment.startedAt = Date.now();
      segment.discard = false;
      segment.autoStopped = false;
      handedOff = true;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) segment.chunks.push(event.data);
      };

      recorder.onerror = (event) => {
        const error = event && event.error ? event.error : null;
        const message = `录音过程中出错：${(error && error.message) || '未知错误'}。请重试。`;
        showGlobalAlert(message);
        announce(message);
        segment.discard = true;
        stopRecording(key, true);
      };

      recorder.onstop = () => {
        void handleRecordingStop(segment, recorder);
      };

      // 每秒切一个分片，避免长时间录音把所有数据堆在一个巨大的 Blob 里
      recorder.start(1000);
      startTimer(segment);
      startLevelMeter(segment);
      announce(`开始录制${segment.label}`);
      if (segment.nodes) {
        segment.nodes.card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    } finally {
      // 任何失败路径都要释放已拿到但没交接出去的流，并解除等待窗口
      if (!handedOff && stream) stopStream({ stream });
      segment.pending = false;
      state.starting = false;
      updateUI();
    }
  }

  async function handleRecordingStop(segment, recorder) {
    const elapsed = (Date.now() - segment.startedAt) / 1000;
    const autoStopped = segment.autoStopped;
    stopStream(segment);
    stopLevelMeter(segment);
    segment.recording = false;
    segment.autoStopped = false;
    stopTimer(segment);
    if (segment.nodes) {
      segment.nodes.card.classList.remove('is-active');
      showElement(segment.nodes.progressWrap, false);
      showElement(segment.nodes.levelWrap, false);
      showElement(segment.nodes.liveNote, false);
    }

    const chunks = segment.chunks;
    segment.chunks = [];

    if (segment.discard) {
      segment.discard = false;
      updateUI();
      return;
    }

    if (autoStopped) {
      announce(`已达到最长录音时间，自动停止${segment.label}`);
    }

    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    if (blob.size === 0) {
      showGlobalAlert('这次录音没有采集到任何声音，请检查麦克风后重录。');
      announce('录音失败：没有采集到任何声音');
      updateUI();
      return;
    }

    segment.blob = blob;
    segment.url = URL.createObjectURL(blob);
    segment.seconds = elapsed;
    updateUI();

    // 时长以产物实际值为准；读不到时保留上面的过程耗时估算
    const url = segment.url;
    const actual = await readBlobDuration(url);
    if (actual && segment.url === url) {
      segment.seconds = actual;
      updateUI();
    }
    announce(`已录完${segment.label}，时长约 ${Math.round(segment.seconds)} 秒`);
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
      stopLevelMeter(segment);
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
        segment.autoStopped = true;
        stopRecording(segment.key, false);
        return;
      }
      if (state.config && elapsed >= state.config.targetSeconds && !segment.targetAnnounced) {
        segment.targetAnnounced = true;
        announce(`已录满 ${state.config.targetSeconds} 秒，可以停止`);
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
    const { nodes } = segment;
    if (!nodes || !state.config) return;
    const config = state.config;
    const max = config.maxSeconds;

    nodes.timer.textContent = formatSeconds(elapsed);

    if (!segment.recording) {
      nodes.progressFill.style.width = '0';
      return;
    }

    const ratio = Math.max(0, Math.min(1, elapsed / max));
    const reached = elapsed >= config.targetSeconds;
    const nearMax = !reached && elapsed >= max * 0.9;
    const under = elapsed < config.minSeconds;

    nodes.progressFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    nodes.progressFill.classList.toggle('is-under', under);
    nodes.progressFill.classList.toggle('is-reached', reached);
    nodes.progressFill.classList.toggle('is-near-max', nearMax);

    nodes.progressBar.setAttribute('aria-valuemax', String(max));
    nodes.progressBar.setAttribute('aria-valuenow', String(Math.min(max, Math.round(elapsed))));

    if (reached) {
      nodes.progressText.textContent = `已录满 ${config.targetSeconds} 秒，可以停止（最长 ${max} 秒）。`;
    } else {
      const remain = Math.max(0, config.targetSeconds - elapsed);
      nodes.progressText.textContent = `已录 ${elapsed.toFixed(1)} 秒，目标 ${config.targetSeconds} 秒，还差约 ${Math.ceil(remain)} 秒。`;
    }
  }

  // ---------------------------------------------------------------- 电平表与静音提示

  /**
   * 只读的输入电平：麦克风流一路进 MediaRecorder（录制数据不变），
   * 另一路接 AnalyserNode 做可视化。任何异常都静默降级，不影响录音。
   */
  function startLevelMeter(segment) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || !segment.stream) return;

    let ctx;
    try {
      ctx = new AudioCtx();
    } catch {
      return;
    }

    try {
      const source = ctx.createMediaStreamSource(segment.stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const useFloat = typeof analyser.getFloatTimeDomainData === 'function';
      const meter = {
        ctx,
        source,
        analyser,
        useFloat,
        floatData: useFloat ? new Float32Array(analyser.fftSize) : null,
        byteData: useFloat ? null : new Uint8Array(analyser.fftSize),
        rafId: 0,
        silentSince: 0,
      };
      segment.meter = meter;

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const tick = () => {
        if (!segment.recording || segment.meter !== meter) return;
        const rms = computeRms(analyser, meter);
        if (segment.nodes) {
          const level = Math.max(0, Math.min(1, rms * LEVEL_SCALE));
          segment.nodes.levelFill.style.width = `${(level * 100).toFixed(1)}%`;
        }

        if (rms < SILENCE_RMS) {
          if (!meter.silentSince) meter.silentSince = performance.now();
          if (
            !segment.silenceWarned &&
            performance.now() - meter.silentSince >= SILENCE_HOLD_MS
          ) {
            segment.silenceWarned = true;
            if (segment.nodes) {
              showElement(segment.nodes.liveNote, true);
              setText(segment.nodes.liveNote, '没有检测到声音，请检查麦克风是否正常。');
            }
            announce('没有检测到声音，请检查麦克风');
          }
        } else {
          meter.silentSince = 0;
        }

        meter.rafId = window.requestAnimationFrame(tick);
      };

      meter.rafId = window.requestAnimationFrame(tick);
      if (segment.nodes) {
        segment.nodes.levelFill.style.width = '0';
        showElement(segment.nodes.levelWrap, true);
      }
    } catch {
      try {
        ctx.close();
      } catch {
        // 忽略：降级即可
      }
    }
  }

  function computeRms(analyser, meter) {
    if (meter.useFloat) {
      analyser.getFloatTimeDomainData(meter.floatData);
      const data = meter.floatData;
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
      return Math.sqrt(sum / data.length);
    }
    analyser.getByteTimeDomainData(meter.byteData);
    const data = meter.byteData;
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      const value = (data[i] - 128) / 128;
      sum += value * value;
    }
    return Math.sqrt(sum / data.length);
  }

  function stopLevelMeter(segment) {
    const meter = segment.meter;
    if (!meter) return;
    segment.meter = null;
    if (meter.rafId) window.cancelAnimationFrame(meter.rafId);
    try {
      meter.source.disconnect();
    } catch {
      // 忽略
    }
    try {
      const closing = meter.ctx.close();
      if (closing && typeof closing.catch === 'function') closing.catch(() => {});
    } catch {
      // 忽略
    }
    if (segment.nodes) {
      segment.nodes.levelFill.style.width = '0';
      showElement(segment.nodes.levelWrap, false);
      showElement(segment.nodes.liveNote, false);
    }
  }

  /** 读取 Blob 的实际可播时长；读不到返回 null。 */
  function readBlobDuration(url) {
    return new Promise((resolve) => {
      const audio = document.createElement('audio');
      let settled = false;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        audio.removeAttribute('src');
        resolve(value);
      };

      const inspect = () => {
        const duration = audio.duration;
        if (Number.isFinite(duration) && duration > 0) {
          finish(duration);
        }
      };

      const timeout = window.setTimeout(() => finish(null), DURATION_READ_TIMEOUT_MS);

      audio.preload = 'metadata';
      audio.addEventListener('loadedmetadata', () => {
        inspect();
        if (!settled && audio.duration === Number.POSITIVE_INFINITY) {
          // Chrome 的 MediaRecorder webm 常报 Infinity，用一次超远 seek 逼它算出真实时长
          try {
            audio.currentTime = 1e7;
          } catch {
            finish(null);
          }
        }
      });
      audio.addEventListener('durationchange', inspect);
      audio.addEventListener('error', () => finish(null));
      audio.src = url;
      audio.load();
    });
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
        nodes.status.classList.remove('done');
        nodes.recordButton.disabled = true;
        nodes.recordButton.textContent = '录音中';
        nodes.stopButton.disabled = false;
        nodes.player.classList.add('hidden');
        nodes.note.classList.add('hidden');
        nodes.card.classList.add('is-active');
        showElement(nodes.progressWrap, true);
        showElement(nodes.liveNote, segment.silenceWarned);
      } else if (segment.pending) {
        // 正在等 getUserMedia：明确反馈并挡住重复点击
        nodes.status.textContent = '准备中……';
        nodes.status.classList.remove('recording');
        nodes.status.classList.remove('done');
        nodes.recordButton.disabled = true;
        nodes.recordButton.textContent = '准备中……';
        nodes.stopButton.disabled = true;
        nodes.player.classList.add('hidden');
        nodes.note.classList.add('hidden');
        nodes.card.classList.remove('is-active');
        showElement(nodes.progressWrap, false);
        showElement(nodes.liveNote, false);
      } else {
        nodes.status.classList.remove('recording');
        nodes.stopButton.disabled = true;
        nodes.recordButton.disabled = state.busy || state.starting;
        nodes.card.classList.remove('is-active');
        showElement(nodes.progressWrap, false);
        showElement(nodes.liveNote, false);

        if (segment.blob) {
          nodes.status.textContent = `已录制 ${formatSeconds(segment.seconds)}`;
          nodes.status.classList.add('done');
          nodes.recordButton.textContent = '重新录制';
          nodes.player.src = segment.url;
          nodes.player.classList.remove('hidden');
          if (segment.seconds < minSeconds) {
            nodes.note.textContent = `这段录音只有 ${formatSeconds(segment.seconds)}，短于要求的 ${minSeconds} 秒，请重录。`;
            nodes.note.classList.add('is-warn');
            nodes.note.classList.remove('hidden');
            problems.push(`${segment.label}录音太短`);
          } else {
            nodes.note.classList.add('hidden');
            nodes.note.classList.remove('is-warn');
          }
        } else {
          nodes.status.textContent = '未录音';
          nodes.status.classList.remove('done');
          nodes.recordButton.textContent = '开始录音';
          nodes.player.classList.add('hidden');
          nodes.note.textContent = `请朗读这段文字，录满 ${state.config.targetSeconds} 秒左右。`;
          nodes.note.classList.remove('is-warn');
          nodes.note.classList.remove('hidden');
          problems.push(`${segment.label}还没有录音`);
        }
      }
    }

    const anyBlob = Array.from(state.segments.values()).some((segment) => !!segment.blob);
    dom.nameSubmit.textContent = anyBlob ? '保存并返回录音' : '开始录音';

    const canSubmit = !state.busy && !state.starting && !isAnyRecording() && problems.length === 0;
    dom.submitButton.disabled = !canSubmit;
    dom.submitButton.textContent = state.busy
      ? '正在提交……'
      : state.submitFailed
        ? '重试提交'
        : '提交录音';

    if (state.busy) {
      setText(dom.submitHint, '正在上传，请勿关闭页面。');
    } else if (problems.length === 0) {
      setText(
        dom.submitHint,
        '两段都录好了，可以提交。提交后如需修改，可以再次录制并提交，会覆盖上一次的录音。'
      );
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
    if (status === 408) return '上传超时，已终止这次提交，请重试。';
    if (status === 413) return '音频文件太大，请缩短录音时间后重试。';
    if (status === 500) return '服务端处理失败，请稍后重试。';
    return `提交失败（HTTP ${status}）。`;
  }

  function setProgress(percent, text) {
    showElement(dom.progress, true);
    if (percent === null || percent === undefined) {
      dom.progressFill.classList.add('is-indeterminate');
      dom.progressFill.style.width = '100%';
      dom.progressBar.setAttribute('aria-valuenow', '0');
      dom.progressBar.setAttribute('aria-valuetext', '上传中，进度未知');
    } else {
      dom.progressFill.classList.remove('is-indeterminate');
      dom.progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
      dom.progressBar.setAttribute('aria-valuenow', String(Math.round(percent)));
      dom.progressBar.removeAttribute('aria-valuetext');
    }
    setText(dom.progressText, text);
  }

  function submitRecordings() {
    if (state.busy) return;

    const form = new FormData();
    form.append('code', state.code);
    form.append('name', state.name);
    for (const segment of state.segments.values()) {
      if (!segment.blob) return;
      form.append(segment.key, segment.blob, blobFileName(segment));
    }

    state.busy = true;
    state.submitFailed = false;
    clearFieldError(dom.submitError);
    clearNotice(dom.submitNotice);
    setProgress(0, '正在上传两段录音……');
    showElement(dom.cancelUploadButton, true);
    updateUI();

    const xhr = new XMLHttpRequest();
    state.xhr = xhr;
    xhr.open('POST', '/api/submit');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total) {
        const percent = Math.max(1, Math.min(100, Math.round((event.loaded / event.total) * 100)));
        setProgress(percent, `正在上传……${percent}%`);
      } else {
        setProgress(null, '正在上传……（浏览器未提供进度）');
      }
    };

    xhr.onload = () => {
      finishSubmitRequest(() => {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = null;
        }

        if (xhr.status === 200 && data && data.ok) {
          handleSubmitSuccess(data);
          return;
        }

        if (xhr.status === 401) {
          // 口令失效：退回第一步，姓名与两段录音都保留，不用重录
          state.code = '';
          showStep('code');
          dom.codeInput.value = '';
          showFieldError(dom.codeError, '口令不正确或已失效，请重新输入口令。已录好的两段录音和姓名会保留。');
          announce('口令失效，请重新输入口令');
          return;
        }

        handleSubmitFailure(messageFromResponse(data, xhr.status));
      });
    };

    xhr.onerror = () => {
      finishSubmitRequest(() => handleSubmitFailure('网络错误，提交失败。请检查网络后重试。'));
    };

    xhr.onabort = () => {
      finishSubmitRequest(() => {
        showNotice(dom.submitNotice, '已取消上传。两段录音还在，可以重新提交。');
      });
    };

    xhr.send(form);
  }

  function finishSubmitRequest(action) {
    state.xhr = null;
    state.busy = false;
    showElement(dom.progress, false);
    dom.progressFill.classList.remove('is-indeterminate');
    dom.progressFill.style.width = '0';
    dom.progressBar.setAttribute('aria-valuenow', '0');
    dom.progressBar.removeAttribute('aria-valuetext');
    showElement(dom.cancelUploadButton, false);
    action();
    updateUI();
  }

  function handleSubmitFailure(message) {
    state.submitFailed = true;
    showFieldError(dom.submitError, message);
    announce(`提交失败：${message}`);
  }

  function handleSubmitSuccess(data) {
    state.submitSucceeded = true;
    showDone(data.name || state.name);
    announce('提交成功');
  }

  function renderDoneSummary(name) {
    dom.doneSummary.textContent = '';
    const items = [['姓名', name]];
    for (const segment of state.segments.values()) {
      items.push([segment.label, formatSeconds(segment.seconds)]);
    }
    items.push(['提交时间', new Date().toLocaleString('zh-CN', { hour12: false })]);
    for (const [label, value] of items) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      dom.doneSummary.appendChild(dt);
      dom.doneSummary.appendChild(dd);
    }
  }

  function showDone(name) {
    setText(
      dom.doneMessage,
      `已收到「${name}」的录音，感谢配合！如果发现读错了，可以点下面的按钮重新录制并再次提交，新录音会覆盖这一次的。`
    );
    renderDoneSummary(name);
    showStep('done');
  }

  function resetSegments() {
    for (const segment of state.segments.values()) {
      stopTimer(segment);
      stopLevelMeter(segment);
      stopStream(segment);
      clearSegmentBlob(segment);
      segment.recording = false;
      segment.pending = false;
      segment.chunks = [];
      segment.recorder = null;
      segment.discard = false;
      segment.autoStopped = false;
      if (segment.nodes) {
        segment.nodes.note.classList.add('hidden');
        segment.nodes.liveNote.classList.add('hidden');
        showElement(segment.nodes.progressWrap, false);
        showElement(segment.nodes.levelWrap, false);
      }
    }
    state.submitFailed = false;
    clearFieldError(dom.submitError);
    clearNotice(dom.submitNotice);
    clearGlobalAlert();
    updateUI();
  }

  /** 有未提交的内容、或正在上传时，离开页面前提醒。提交成功后不再拦。 */
  function hasUnsavedWork() {
    if (state.busy) return true;
    if (isAnyRecording()) return true;
    if (state.submitSucceeded) return false;
    for (const segment of state.segments.values()) {
      if (segment.blob) return true;
    }
    return false;
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
        if (!dom.nameInput.value) dom.nameInput.value = readStoredName();
        showStep('name');
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
    storeName(name);
    showStep('record');
    updateUI();
  });

  dom.editNameButton.addEventListener('click', () => {
    if (isAnyRecording()) {
      showGlobalAlert('请先停止正在进行的录音，再修改姓名。');
      return;
    }
    if (!dom.nameInput.value) dom.nameInput.value = state.name || readStoredName();
    showStep('name');
    updateUI();
  });

  dom.submitButton.addEventListener('click', submitRecordings);

  dom.cancelUploadButton.addEventListener('click', () => {
    if (state.xhr && state.busy) state.xhr.abort();
  });

  dom.againButton.addEventListener('click', () => {
    state.submitSucceeded = false;
    resetSegments();
    showStep('record');
  });

  window.addEventListener('beforeunload', (event) => {
    if (hasUnsavedWork()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  // ---------------------------------------------------------------- 启动

  (async function init() {
    const environmentOk = checkEnvironment();
    dom.nameInput.value = readStoredName();

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

    showElement(dom.stepNav, true);
    showStep('code', { focus: environmentOk });
    if (environmentOk) {
      dom.codeInput.focus();
    }
  })();
})();