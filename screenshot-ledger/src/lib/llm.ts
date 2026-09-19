import {
  buildChatRequest,
  ParseError,
  parseExtraction,
  type LlmExtraction,
} from './llm-core';
import type { LlmConfig } from './types';

export type LlmErrorKind =
  | 'config'
  | 'network'
  | 'timeout'
  | 'auth'
  | 'rate'
  | 'server'
  | 'parse';

export class LlmError extends Error {
  readonly kind: LlmErrorKind;

  constructor(kind: LlmErrorKind, message: string) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
  }
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface FetchInitLike {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: unknown;
}

export type FetchLike = (url: string, init: FetchInitLike) => Promise<FetchResponseLike>;

export interface RecognizeDeps {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60000;

export function userMessageForLlmError(error: unknown): string {
  if (error instanceof LlmError) {
    switch (error.kind) {
      case 'config':
        return error.message;
      case 'timeout':
        return '识别超时了（网络慢或模型响应慢），可以点重试。';
      case 'auth':
        return 'LLM 配置不可用（Key 无效或无权限），请联系打包人。';
      case 'rate':
        return '调用太频繁或额度用尽，稍后再试。';
      case 'network':
        return '网络连接失败，检查手机网络后重试。';
      case 'server':
        return '模型服务暂时不可用，稍后重试。';
      case 'parse':
        return '模型回复无法解析，可以重试或改为手动填写。';
    }
  }
  if (error instanceof ParseError) return '模型回复无法解析，可以重试或改为手动填写。';
  return '识别失败，可以重试或改为手动填写。';
}

function extractContent(data: unknown): string | null {
  const choices = (data as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown } })?.message;
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (part as { text?: unknown })?.text)
      .filter((part): part is string => typeof part === 'string')
      .join('');
    return text || null;
  }
  return null;
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || /abort/i.test(error.message);
}

async function callOnce(
  fetchImpl: FetchLike,
  config: LlmConfig,
  imageBase64: string,
  strict: boolean,
  timeoutMs: number,
): Promise<string> {
  const request = buildChatRequest(config, imageBase64, strict);
  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new LlmError('timeout', `请求超过 ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const fetchPromise = fetchImpl(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal: controller?.signal,
  });
  fetchPromise.catch(() => undefined);

  let response: FetchResponseLike;
  try {
    response = await Promise.race([fetchPromise, timeoutPromise]);
  } catch (error) {
    if (error instanceof LlmError) throw error;
    if (isAbortError(error)) throw new LlmError('timeout', `请求超过 ${timeoutMs}ms`);
    throw new LlmError('network', '网络请求失败');
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new LlmError('auth', `HTTP ${response.status}`);
  }
  if (response.status === 429) {
    throw new LlmError('rate', 'HTTP 429');
  }
  if (!response.ok) {
    throw new LlmError('server', `HTTP ${response.status}`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new LlmError('parse', '响应不是 JSON');
  }
  const content = extractContent(data);
  if (!content || !content.trim()) throw new LlmError('parse', '响应内容为空');
  return content;
}

export async function recognizeImage(
  imageBase64: string,
  config: LlmConfig,
  deps: RecognizeDeps = {},
): Promise<LlmExtraction> {
  const fetchImpl =
    deps.fetchImpl ?? ((globalThis as { fetch?: unknown }).fetch as FetchLike | undefined);
  if (!fetchImpl) throw new LlmError('config', '当前环境不支持网络请求');
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const first = await callOnce(fetchImpl, config, imageBase64, false, timeoutMs);
  try {
    return parseExtraction(first);
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
    const second = await callOnce(fetchImpl, config, imageBase64, true, timeoutMs);
    try {
      return parseExtraction(second);
    } catch (retryError) {
      if (retryError instanceof ParseError) throw new LlmError('parse', retryError.message);
      throw retryError;
    }
  }
}
