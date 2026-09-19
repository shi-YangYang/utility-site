import { DEFAULT_CATEGORIES, DEFAULT_CATEGORY, PLATFORMS } from './categories';
import { normalizeTxTime } from './dates';
import { parseAmountToCents } from './money';
import type { Confidence, Direction, LlmConfig, LlmExtraction } from './types';

export type { Confidence, LlmExtraction } from './types';

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export function buildSystemPrompt(categories: readonly string[] = DEFAULT_CATEGORIES): string {
  return [
    '你是一个记账助手。用户会给你一张手机截图，通常来自京东、淘宝、拼多多、微信或支付宝，内容是付款、转账或收款的凭证。',
    '请从中提取记账所需信息，并且只输出一个 JSON 对象，不要输出任何其他文字，不要使用 Markdown 代码块。',
    '',
    'JSON 字段：',
    '{',
    '  "is_payment": true,                 // 这张图是否为付款/转账/收款凭证；不是则为 false',
    '  "amount": "23.50",                  // 金额，字符串，最多两位小数',
    '  "direction": "expense",             // expense=支出（付款），income=收入（收款、退款到账）',
    '  "merchant": "商户名或收款方",        // 识别不到用 null',
    `  "category": "分类",                  // 必须从以下列表选一个：${categories.join('、')}`,
    `  "platform": "平台",                  // 从以下列表选一个或 null：${PLATFORMS.join('、')}`,
    '  "tx_time": "2026-09-18 12:30",     // 交易时间，格式 YYYY-MM-DD HH:mm；识别不到用 null',
    '  "note": "订单号或商品摘要",          // 可空',
    '  "confidence": "high"                // 对识别结果的把握：high / medium / low',
    '}',
    '',
    '注意：金额必须来自图中实际数字，不要猜测；不确定的字段用 null。',
  ].join('\n');
}

export const STRICT_RETRY_SUFFIX =
  '\n\n重要：上一次回复无法解析。请严格只输出一个合法 JSON 对象，不要包含任何解释文字或代码块标记。';

export interface ChatRequestOptions {
  strict?: boolean;
  categories?: readonly string[];
}

export function buildChatRequest(
  config: LlmConfig,
  imageBase64: string,
  options: ChatRequestOptions = {},
): { url: string; headers: Record<string, string>; body: string } {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const basePrompt = buildSystemPrompt(options.categories);
  const systemPrompt = options.strict ? `${basePrompt}${STRICT_RETRY_SUFFIX}` : basePrompt;
  const body: Record<string, unknown> = {
    model: config.model,
    temperature: 0,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请识别这张截图，并按要求只输出 JSON。' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ],
      },
    ],
  };
  if (config.baseUrl.includes('aliyuncs.com')) {
    body.enable_thinking = false;
  }
  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  };
}

export function extractJsonBlock(content: string): string | null {
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseExtraction(
  content: string,
  categories: readonly string[] = DEFAULT_CATEGORIES,
): LlmExtraction {
  const jsonText = extractJsonBlock(content);
  if (!jsonText) throw new ParseError('模型回复中没有 JSON');
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new ParseError('模型回复不是合法 JSON');
  }
  return normalizeRaw(raw, categories);
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (['true', 'yes', '是', '1'].includes(lowered)) return true;
    if (['false', 'no', '否', '0'].includes(lowered)) return false;
  }
  return null;
}

function pickOption<T extends readonly string[]>(value: string | null, options: T): T[number] | null {
  if (!value) return null;
  return (options as readonly string[]).includes(value) ? (value as T[number]) : null;
}

function normalizeDirection(value: string | null): Direction {
  if (!value) return 'expense';
  const lowered = value.trim().toLowerCase();
  if (['income', '收入', '收款', '退款'].includes(lowered)) return 'income';
  return 'expense';
}

function normalizeConfidence(value: string | null): Confidence | null {
  if (!value) return null;
  const lowered = value.trim().toLowerCase();
  if (lowered === 'high' || lowered === '高') return 'high';
  if (lowered === 'medium' || lowered === '中') return 'medium';
  if (lowered === 'low' || lowered === '低') return 'low';
  return null;
}

function truncate(value: string | null, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

export function normalizeRaw(
  raw: unknown,
  categories: readonly string[] = DEFAULT_CATEGORIES,
): LlmExtraction {
  const source = (raw ?? {}) as Record<string, unknown>;
  const amountText = asString(source.amount);
  const amountCents = amountText ? parseAmountToCents(amountText) : null;
  const isPaymentFlag = asBoolean(source.is_payment);
  const categoryText = asString(source.category);

  return {
    isPayment: isPaymentFlag ?? amountCents !== null,
    amountCents,
    direction: normalizeDirection(asString(source.direction)),
    merchant: truncate(asString(source.merchant), 60),
    category:
      categoryText && categories.includes(categoryText) ? categoryText : DEFAULT_CATEGORY,
    platform: pickOption(asString(source.platform), PLATFORMS),
    txTime: (() => {
      const text = asString(source.tx_time);
      return text ? normalizeTxTime(text) : null;
    })(),
    note: truncate(asString(source.note), 120),
    confidence: normalizeConfidence(asString(source.confidence)),
  };
}
