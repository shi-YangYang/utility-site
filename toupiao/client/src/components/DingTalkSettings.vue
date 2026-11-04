<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';

const emit = defineEmits(['saved']);

const loading = ref(true);
const loadError = ref('');
const saving = ref(false);
const settings = ref(null);
const result = ref(null);
const copied = ref(false);

const form = ref({
  publicBaseUrl: '',
  appKey: '',
  appSecret: '',
  corpId: '',
});

const configured = computed(() => Boolean(settings.value?.configured));
const hasSecret = computed(() => Boolean(settings.value?.hasSecret));
const secretPlaceholder = computed(() =>
  hasSecret.value ? '已保存，留空不修改' : '请输入 AppSecret',
);
const callbackUrl = computed(() => {
  const base = form.value.publicBaseUrl.trim().replace(/\/+$/, '');
  return base ? `${base}/api/auth/callback` : '';
});

function applySettings(next) {
  settings.value = next;
  form.value = {
    publicBaseUrl: next.publicBaseUrl || '',
    appKey: next.appKey || '',
    appSecret: '',
    corpId: next.corpId || '',
  };
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    applySettings(await api.getDingTalkSettings());
  } catch (error) {
    loadError.value = error.message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function save() {
  if (saving.value) return;
  saving.value = true;
  result.value = null;
  try {
    const payload = {
      appKey: form.value.appKey.trim(),
      corpId: form.value.corpId.trim(),
      publicBaseUrl: form.value.publicBaseUrl.trim(),
    };
    if (form.value.appSecret) payload.appSecret = form.value.appSecret;
    const next = await api.saveDingTalkSettings(payload);
    applySettings(next);
    result.value = { type: 'success', message: '已保存' };
    emit('saved', next);
  } catch (error) {
    result.value = { type: 'error', message: error.message };
  } finally {
    saving.value = false;
  }
}

async function copyCallback() {
  if (!callbackUrl.value) return;
  try {
    await navigator.clipboard.writeText(callbackUrl.value);
    copied.value = true;
  } catch {
    const input = document.getElementById('dingtalk-callback');
    if (!input) return;
    input.focus();
    input.select();
    try {
      document.execCommand('copy');
      copied.value = true;
    } catch {
      copied.value = false;
    }
  }
  setTimeout(() => {
    copied.value = false;
  }, 1500);
}
</script>

<template>
  <section class="panel dingtalk-panel" aria-labelledby="dingtalk-title" data-testid="dingtalk-panel">
    <div class="panel-head">
      <div class="panel-title-group">
        <h2 id="dingtalk-title">钉钉登录</h2>
        <span
          class="status-pill"
          :class="{ warn: !configured }"
          data-testid="dingtalk-status"
        >
          {{ configured ? '已配置' : '未配置' }}
        </span>
      </div>
    </div>

    <p v-if="loading" class="empty-hint">正在加载配置…</p>
    <p v-else-if="loadError" class="form-error" role="alert">{{ loadError }}</p>

    <form v-else class="settings-form" @submit.prevent="save">
      <div class="settings-grid">
        <label class="field" for="dingtalk-base-url">
          <span>站点地址</span>
          <input
            id="dingtalk-base-url"
            v-model="form.publicBaseUrl"
            type="url"
            autocomplete="url"
            placeholder="https://vote.example.com"
            :disabled="saving"
          />
        </label>
        <label class="field" for="dingtalk-app-key">
          <span>AppKey</span>
          <input
            id="dingtalk-app-key"
            v-model="form.appKey"
            type="text"
            autocomplete="off"
            :disabled="saving"
          />
        </label>
        <label class="field" for="dingtalk-app-secret">
          <span>AppSecret</span>
          <input
            id="dingtalk-app-secret"
            v-model="form.appSecret"
            type="password"
            autocomplete="new-password"
            :placeholder="secretPlaceholder"
            :disabled="saving"
          />
        </label>
        <label class="field" for="dingtalk-corp-id">
          <span>corpId</span>
          <input
            id="dingtalk-corp-id"
            v-model="form.corpId"
            type="text"
            autocomplete="off"
            :disabled="saving"
          />
        </label>
      </div>

      <div class="callback-field">
        <label for="dingtalk-callback">回调地址</label>
        <div class="callback-row">
          <input id="dingtalk-callback" :value="callbackUrl" type="text" readonly />
          <button type="button" class="btn" :disabled="!callbackUrl" @click="copyCallback">
            {{ copied ? '已复制' : '复制' }}
          </button>
        </div>
      </div>

      <div class="settings-actions">
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? '保存中…' : '保存配置' }}
        </button>
        <p
          v-if="result"
          class="settings-result"
          :class="result.type"
          role="status"
          data-testid="dingtalk-result"
        >
          {{ result.message }}
        </p>
      </div>
    </form>
  </section>
</template>
