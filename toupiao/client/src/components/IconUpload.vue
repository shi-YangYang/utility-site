<script setup>
import { computed, ref } from 'vue';
import { api } from '../api.js';

const props = defineProps({
  count: { type: Number, default: 0 },
});

const emit = defineEmits(['uploaded']);

const MAX_ICONS = 99;
const input = ref(null);
const items = ref([]);
const uploading = ref(false);
const summary = ref(null);
let keySeed = 0;

const atLimit = computed(() => props.count >= MAX_ICONS);
const hasPending = computed(() => items.value.some((item) => item.status === 'pending'));
const canUpload = computed(() => !uploading.value && hasPending.value && !atLimit.value);

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusText(item) {
  if (item.status === 'uploading') return '上传中…';
  if (item.status === 'success') {
    return item.icon ? `#${item.icon.id} ${item.icon.name}` : '已上传';
  }
  if (item.status === 'error') return item.message;
  return '等待上传';
}

function onFiles(event) {
  const files = Array.from(event.target.files ?? []);
  items.value = files.map((file) => ({
    key: (keySeed += 1),
    file,
    status: 'pending',
    message: '',
    icon: null,
  }));
  summary.value = null;
  // 允许再次选择同一个文件。
  event.target.value = '';
}

function openPicker() {
  input.value?.click();
}

async function startUpload() {
  if (!canUpload.value) return;
  uploading.value = true;
  summary.value = null;

  let succeeded = 0;
  let failed = 0;
  let lastResult = null;
  for (const item of items.value) {
    if (item.status !== 'pending') continue;
    item.status = 'uploading';
    item.message = '';
    try {
      const result = await api.uploadIcon(item.file);
      const icon = result?.added?.[0] ?? null;
      item.status = 'success';
      item.icon = icon;
      item.message = icon ? `#${icon.id} ${icon.name}` : '上传成功';
      succeeded += 1;
      lastResult = result;
    } catch (error) {
      item.status = 'error';
      item.message = error?.message || '上传失败，请重试';
      failed += 1;
    }
  }

  uploading.value = false;
  summary.value = { succeeded, failed };
  // 整批结束后只刷新一次，避免多张上传时后台并发刷新互相覆盖。
  if (succeeded > 0) emit('uploaded', lastResult);
}
</script>

<template>
  <section class="panel icon-upload-panel" aria-labelledby="icon-upload-title" data-testid="icon-upload-panel">
    <div class="panel-head">
      <div class="panel-title-group">
        <h2 id="icon-upload-title">上传图标</h2>
        <span class="status-pill" :class="{ warn: atLimit }" data-testid="icon-count">
          当前 {{ count }} / {{ MAX_ICONS }}
        </span>
      </div>
      <span class="muted">PNG，单张 ≤ 5 MB</span>
    </div>

    <div class="upload-controls">
      <input
        id="icon-upload-input"
        ref="input"
        class="upload-input"
        type="file"
        accept="image/png"
        aria-label="选择 PNG 图标文件"
        multiple
        :disabled="uploading || atLimit"
        @change="onFiles"
      />
      <button type="button" class="btn" :disabled="uploading || atLimit" @click="openPicker">
        选择 PNG 文件
      </button>
      <button type="button" class="btn btn-primary" :disabled="!canUpload" @click="startUpload">
        {{ uploading ? '上传中…' : '开始上传' }}
      </button>
      <p v-if="atLimit" class="empty-hint">已达 99 张上限</p>
    </div>

    <ul v-if="items.length" class="upload-file-list" data-testid="icon-upload-files">
      <li
        v-for="item in items"
        :key="item.key"
        class="upload-file"
        :class="`is-${item.status}`"
        data-testid="icon-upload-file"
      >
        <span class="upload-file-name" :title="item.file.name">{{ item.file.name }}</span>
        <span class="upload-file-size">{{ formatSize(item.file.size) }}</span>
        <span class="upload-file-status" :class="`is-${item.status}`" data-testid="icon-upload-file-status">
          {{ statusText(item) }}
        </span>
      </li>
    </ul>

    <p
      v-if="summary"
      class="upload-summary"
      :class="{ 'has-error': summary.failed > 0 }"
      role="status"
      data-testid="icon-upload-result"
    >
      成功上传 {{ summary.succeeded }} 张<template v-if="summary.failed > 0">，失败 {{ summary.failed }} 张</template>
    </p>
  </section>
</template>
