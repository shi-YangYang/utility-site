import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadConfig } from '../server/config.js';
import { createStore } from '../server/db.js';
import {
  decryptSecret,
  DINGTALK_SETTING_KEYS,
  encryptSecret,
  publicDingTalkSettings,
  resolveDingTalkSettings,
  saveDingTalkSettings,
  validateDingTalkInput,
} from '../server/dingtalk-config.js';
import { HttpError } from '../server/http.js';
import { createSilentLogger } from './helpers.js';

const SESSION_SECRET = 'unit-test-session-secret-0123456789abcdef';
const OTHER_SECRET = 'another-unit-test-secret-0123456789abcdef';
const SILENT = { warn() {}, info() {}, error() {} };

function makeConfig(env = {}) {
  return loadConfig(
    {
      ADMIN_PASSWORD: 'test-admin-123',
      SESSION_SECRET,
      NODE_ENV: 'test',
      ...env,
    },
    { rootDir: '/tmp' },
  );
}

function makeStore(t) {
  const dir = mkdtempSync(join(tmpdir(), 'toupiao-dingtalk-'));
  const store = createStore({ dataDir: dir, logger: SILENT });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

function isInvalidConfig(error) {
  return (
    error instanceof HttpError &&
    error.status === 400 &&
    error.code === 'INVALID_DINGTALK_CONFIG' &&
    typeof error.message === 'string'
  );
}

test('AppSecret 加解密：AES-256-GCM、随机 IV、篡改/换密钥失败', () => {
  const encrypted = encryptSecret('super-secret-value', SESSION_SECRET);
  assert.match(encrypted, /^v1:[A-Za-z0-9_-]+$/);
  assert.equal(encrypted.includes('super-secret-value'), false);
  assert.equal(decryptSecret(encrypted, SESSION_SECRET), 'super-secret-value');

  const second = encryptSecret('super-secret-value', SESSION_SECRET);
  assert.notEqual(second, encrypted, '每次加密应使用随机 IV');
  assert.equal(decryptSecret(second, SESSION_SECRET), 'super-secret-value');

  assert.equal(decryptSecret(encrypted, OTHER_SECRET), null, '换密钥必须解密失败');
  const tampered = `${encrypted.slice(0, -2)}${encrypted.endsWith('AA') ? 'BB' : 'AA'}`;
  assert.equal(decryptSecret(tampered, SESSION_SECRET), null, '篡改密文必须失败');
  assert.equal(decryptSecret('v1:', SESSION_SECRET), null);
  assert.equal(decryptSecret('v2:abc', SESSION_SECRET), null);
  assert.equal(decryptSecret('not-a-secret', SESSION_SECRET), null);
  assert.equal(decryptSecret(null, SESSION_SECRET), null);
});

test('配置解析：DB 非空 > env，空值回退，source 为 db/env/mixed/none', (t) => {
  const store = makeStore(t);
  const config = makeConfig({
    DINGTALK_APP_KEY: 'env-key',
    DINGTALK_APP_SECRET: 'env-secret',
    DINGTALK_CORP_ID: 'env-corp',
    PUBLIC_BASE_URL: 'https://env.example.com',
  });

  let resolved = resolveDingTalkSettings(store, config, { logger: createSilentLogger() });
  assert.equal(resolved.appKey, 'env-key');
  assert.equal(resolved.appSecret, 'env-secret');
  assert.equal(resolved.corpId, 'env-corp');
  assert.equal(resolved.publicBaseUrl, 'https://env.example.com');
  assert.equal(resolved.callbackUrl, 'https://env.example.com/api/auth/callback');
  assert.equal(resolved.configured, true);
  assert.equal(resolved.hasSecret, true);
  assert.equal(resolved.source, 'env');
  assert.equal(publicDingTalkSettings(resolved).appSecret, undefined);

  store.setSetting(DINGTALK_SETTING_KEYS.appKey, 'db-key');
  store.setSetting(
    DINGTALK_SETTING_KEYS.appSecretEnc,
    encryptSecret('db-secret', SESSION_SECRET),
  );
  store.setSetting(DINGTALK_SETTING_KEYS.corpId, 'db-corp');
  store.setSetting(DINGTALK_SETTING_KEYS.publicBaseUrl, 'https://db.example.com');
  resolved = resolveDingTalkSettings(store, config, { logger: createSilentLogger() });
  assert.equal(resolved.appKey, 'db-key');
  assert.equal(resolved.appSecret, 'db-secret');
  assert.equal(resolved.corpId, 'db-corp');
  assert.equal(resolved.publicBaseUrl, 'https://db.example.com');
  assert.equal(resolved.source, 'db');

  store.deleteSetting(DINGTALK_SETTING_KEYS.corpId);
  resolved = resolveDingTalkSettings(store, config, { logger: createSilentLogger() });
  assert.equal(resolved.corpId, 'env-corp');
  assert.equal(resolved.source, 'mixed');

  store.deleteSetting(DINGTALK_SETTING_KEYS.appSecretEnc);
  resolved = resolveDingTalkSettings(store, config, { logger: createSilentLogger() });
  assert.equal(resolved.appSecret, 'env-secret');
  assert.equal(resolved.source, 'mixed');

  const publicView = publicDingTalkSettings(resolved);
  assert.equal('appSecret' in publicView, false);
  assert.equal('appSecretEnc' in publicView, false);
  assert.equal(JSON.stringify(publicView).includes('env-secret'), false);

  const emptyStore = makeStore(t);
  const empty = resolveDingTalkSettings(emptyStore, makeConfig(), {
    logger: createSilentLogger(),
  });
  assert.equal(empty.configured, false);
  assert.equal(empty.hasSecret, false);
  assert.equal(empty.callbackUrl, '');
  assert.equal(empty.source, 'none');
});

test('解密失败：视为未配置、不崩溃、每个 logger 只警告一次', (t) => {
  const store = makeStore(t);
  store.setSetting(DINGTALK_SETTING_KEYS.appKey, 'db-key');
  store.setSetting(
    DINGTALK_SETTING_KEYS.appSecretEnc,
    encryptSecret('db-secret', SESSION_SECRET),
  );
  store.setSetting(DINGTALK_SETTING_KEYS.publicBaseUrl, 'https://db.example.com');

  const logger = createSilentLogger();
  const config = makeConfig({
    SESSION_SECRET: OTHER_SECRET,
    DINGTALK_APP_SECRET: 'env-secret',
    DINGTALK_APP_KEY: 'env-key',
    PUBLIC_BASE_URL: 'https://env.example.com',
  });
  const resolved = resolveDingTalkSettings(store, config, { logger });
  assert.equal(resolved.appSecret, '', 'DB 密文存在时不应回退到 env secret');
  assert.equal(resolved.hasSecret, false);
  assert.equal(resolved.configured, false);
  assert.equal(resolved.secretDecryptFailed, true);

  resolveDingTalkSettings(store, config, { logger });
  const warnings = logger.entries.filter((entry) => entry.level === 'warn');
  assert.equal(warnings.length, 1, '解密失败只应警告一次');
  assert.match(String(warnings[0].args[0]), /无法解密/);
});

test('配置校验：URL、长度、控制字符与生产 HTTPS', () => {
  const valid = {
    appKey: 'app-key',
    appSecret: 'app-secret',
    corpId: 'corp-id',
    publicBaseUrl: 'https://vote.example.com',
  };
  assert.deepEqual(validateDingTalkInput(valid), valid);
  assert.deepEqual(
    validateDingTalkInput({ appKey: ' app-key ', publicBaseUrl: 'https://vote.example.com/' }),
    {
      appKey: 'app-key',
      appSecret: '',
      corpId: '',
      publicBaseUrl: 'https://vote.example.com',
    },
  );
  assert.equal(
    validateDingTalkInput({ ...valid, publicBaseUrl: 'http://localhost:3001' }, {
      isProduction: true,
    }).publicBaseUrl,
    'http://localhost:3001',
  );
  assert.equal(
    validateDingTalkInput({ ...valid, publicBaseUrl: 'http://127.0.0.1:3001' }, {
      isProduction: true,
    }).publicBaseUrl,
    'http://127.0.0.1:3001',
  );

  const rejected = [
    null,
    [],
    { ...valid, publicBaseUrl: 'https://vote.example.com/path' },
    { ...valid, publicBaseUrl: 'https://vote.example.com?x=1' },
    { ...valid, publicBaseUrl: 'https://vote.example.com#x' },
    { ...valid, publicBaseUrl: 'ftp://vote.example.com' },
    { ...valid, publicBaseUrl: 'not a url' },
    { ...valid, publicBaseUrl: 123 },
    { ...valid, appKey: 123 },
    { ...valid, appKey: 'k'.repeat(129) },
    { ...valid, appSecret: 's'.repeat(257) },
    { ...valid, appSecret: 'line\nbreak' },
    { ...valid, appSecret: '   ' },
    { ...valid, corpId: 'c'.repeat(129) },
    { ...valid, corpId: 123 },
  ];
  for (const input of rejected) {
    assert.throws(
      () => validateDingTalkInput(input),
      isInvalidConfig,
      `应拒绝 ${JSON.stringify(input, (key, value) => (key === 'appSecret' ? '[redacted]' : value))}`,
    );
  }
  assert.throws(
    () =>
      validateDingTalkInput(
        { ...valid, publicBaseUrl: 'http://vote.example.com' },
        { isProduction: true },
      ),
    isInvalidConfig,
    '生产环境非本机 http 地址必须拒绝',
  );
});

test('保存配置：首次必须提供 secret、省略保留、空字段回退 env、日志不含 secret', (t) => {
  const store = makeStore(t);
  const config = makeConfig();
  const logger = createSilentLogger();

  assert.throws(
    () =>
      saveDingTalkSettings(
        store,
        { appKey: 'app-key', publicBaseUrl: 'https://vote.example.com' },
        { config, logger },
      ),
    (error) => error instanceof HttpError && error.status === 400 && error.code === 'SECRET_REQUIRED',
  );

  const saved = saveDingTalkSettings(
    store,
    {
      appKey: 'app-key',
      appSecret: 'never-log-this-secret',
      corpId: 'corp-id',
      publicBaseUrl: 'https://vote.example.com',
    },
    { config, logger },
  );
  assert.equal(saved.configured, true);
  assert.equal(saved.hasSecret, true);
  assert.equal(saved.source, 'db');

  const encrypted = store.getSetting(DINGTALK_SETTING_KEYS.appSecretEnc);
  assert.match(encrypted, /^v1:/);
  assert.equal(encrypted.includes('never-log-this-secret'), false);
  assert.equal(decryptSecret(encrypted, SESSION_SECRET), 'never-log-this-secret');

  const kept = saveDingTalkSettings(
    store,
    {
      appKey: 'app-key-2',
      corpId: '',
      publicBaseUrl: 'https://vote.example.com',
    },
    { config, logger },
  );
  assert.equal(kept.appKey, 'app-key-2');
  assert.equal(kept.corpId, '');
  assert.equal(kept.hasSecret, true);
  assert.equal(store.getSetting(DINGTALK_SETTING_KEYS.appSecretEnc), encrypted);

  const logText = JSON.stringify(logger.entries);
  assert.equal(logText.includes('never-log-this-secret'), false, '日志不得包含 AppSecret');
  assert.match(logText, /登录配置已更新/);

  const cleared = saveDingTalkSettings(
    store,
    { appKey: '', corpId: '', publicBaseUrl: '' },
    { config, logger },
  );
  assert.equal(cleared.configured, false);
  assert.equal(cleared.appKey, '');
  assert.equal(cleared.publicBaseUrl, '');
  assert.equal(store.getSetting(DINGTALK_SETTING_KEYS.appKey), null);
  assert.equal(store.getSetting(DINGTALK_SETTING_KEYS.publicBaseUrl), null);
  assert.equal(store.getSetting(DINGTALK_SETTING_KEYS.corpId), null);

  const envConfig = makeConfig({
    DINGTALK_APP_KEY: 'env-key',
    DINGTALK_APP_SECRET: 'env-secret',
    PUBLIC_BASE_URL: 'https://env.example.com',
  });
  const envStore = makeStore(t);
  const envSaved = saveDingTalkSettings(
    envStore,
    { appKey: 'db-key', publicBaseUrl: 'https://db.example.com' },
    { config: envConfig, logger: createSilentLogger() },
  );
  assert.equal(envSaved.configured, true, 'env 中已有 secret 时允许只保存 AppKey/站点地址');
  assert.equal(envSaved.source, 'mixed');
  assert.equal(envStore.getSetting(DINGTALK_SETTING_KEYS.appSecretEnc), null);

  const envFallback = saveDingTalkSettings(
    envStore,
    { appKey: '', publicBaseUrl: '' },
    { config: envConfig, logger: createSilentLogger() },
  );
  assert.equal(envFallback.configured, true);
  assert.equal(envFallback.appKey, 'env-key');
  assert.equal(envFallback.publicBaseUrl, 'https://env.example.com');
  assert.equal(envFallback.source, 'env');
});

test('换 SESSION_SECRET：已存 secret 无法解密，重新填写后恢复', (t) => {
  const store = makeStore(t);
  const config = makeConfig();
  saveDingTalkSettings(
    store,
    {
      appKey: 'app-key',
      appSecret: 'app-secret',
      publicBaseUrl: 'https://vote.example.com',
    },
    { config, logger: createSilentLogger() },
  );

  const changed = makeConfig({ SESSION_SECRET: OTHER_SECRET });
  const logger = createSilentLogger();
  const resolved = resolveDingTalkSettings(store, changed, { logger });
  assert.equal(resolved.configured, false);
  assert.equal(resolved.hasSecret, false);
  assert.equal(resolved.secretDecryptFailed, true);

  const recovered = saveDingTalkSettings(
    store,
    {
      appKey: 'app-key',
      appSecret: 'new-secret',
      publicBaseUrl: 'https://vote.example.com',
    },
    { config: changed, logger },
  );
  assert.equal(recovered.configured, true);
  assert.equal(recovered.hasSecret, true);
  assert.equal(
    decryptSecret(store.getSetting(DINGTALK_SETTING_KEYS.appSecretEnc), OTHER_SECRET),
    'new-secret',
  );
});
