import {
  buildSystemPrompt,
  buildChatRequest,
  extractJsonBlock,
  normalizeRaw,
  ParseError,
  parseExtraction,
  STRICT_RETRY_SUFFIX,
} from '../llm-core';
import type { LlmConfig } from '../types';

const CONFIG: LlmConfig = {
  baseUrl: 'https://example.com/v1/',
  apiKey: 'sk-test',
  model: 'vision-model',
};

describe('extractJsonBlock', () => {
  it('提取裸 JSON', () => {
    expect(extractJsonBlock('{"a":1}')).toBe('{"a":1}');
  });

  it('去掉代码块和前后文字', () => {
    expect(extractJsonBlock('好的，结果如下：\n```json\n{"a":1}\n```\n希望有用')).toBe('{"a":1}');
    expect(extractJsonBlock('前言 {"a": {"b": 2}} 后记')).toBe('{"a": {"b": 2}}');
  });

  it('字符串里的花括号不影响配对', () => {
    expect(extractJsonBlock('{"note":"含 } 和 { 的字符串"}')).toBe(
      '{"note":"含 } 和 { 的字符串"}',
    );
  });

  it('没有 JSON 时返回 null', () => {
    expect(extractJsonBlock('无法识别')).toBeNull();
    expect(extractJsonBlock('{"a":1')).toBeNull();
  });
});

describe('buildSystemPrompt', () => {
  it('把当前分类与平台列表写进提示词', () => {
    const prompt = buildSystemPrompt(['餐饮', '宠物'], ['京东', '山姆']);
    expect(prompt).toContain('餐饮、宠物');
    expect(prompt).toContain('京东、山姆');
    expect(prompt).not.toContain('支付方式');
  });
});

describe('buildChatRequest', () => {
  it('拼接 URL、鉴权头与请求体', () => {
    const request = buildChatRequest(CONFIG, 'BASE64DATA');
    expect(request.url).toBe('https://example.com/v1/chat/completions');
    expect(request.headers.Authorization).toBe('Bearer sk-test');
    expect(request.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(request.body);
    expect(body.model).toBe('vision-model');
    expect(body.temperature).toBe(0);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).not.toContain(STRICT_RETRY_SUFFIX);
    expect(body.messages[1].content[1].image_url.url).toBe('data:image/jpeg;base64,BASE64DATA');
  });

  it('strict 模式追加更严格的指令', () => {
    const request = buildChatRequest(CONFIG, 'X', { strict: true });
    const body = JSON.parse(request.body);
    expect(body.messages[0].content).toContain(STRICT_RETRY_SUFFIX);
  });

  it('使用自定义分类与平台列表', () => {
    const request = buildChatRequest(CONFIG, 'X', {
      categories: ['餐饮', '宠物'],
      platforms: ['京东', '山姆'],
    });
    const body = JSON.parse(request.body);
    expect(body.messages[0].content).toContain('餐饮、宠物');
    expect(body.messages[0].content).toContain('京东、山姆');
  });

  it('阿里云百炼地址关闭思考模式，其他服务商不加该参数', () => {
    const aliyun = buildChatRequest(
      { ...CONFIG, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      'X',
    );
    expect(JSON.parse(aliyun.body).enable_thinking).toBe(false);
    expect(JSON.parse(buildChatRequest(CONFIG, 'X').body).enable_thinking).toBeUndefined();
  });
});

describe('parseExtraction', () => {
  it('解析完整回复', () => {
    const extraction = parseExtraction(
      '```json\n{"is_payment": true, "amount": "23.50", "direction": "expense", "merchant": "肯德基", "category": "餐饮", "tx_time": "2026-09-18 12:30", "note": "订单 123", "confidence": "high"}\n```',
    );
    expect(extraction).toEqual({
      isPayment: true,
      amountCents: 2350,
      direction: 'expense',
      merchant: '肯德基',
      category: '餐饮',
      platform: null,
      txTime: '2026-09-18T12:30',
      note: '订单 123',
      confidence: 'high',
    });
  });

  it('识别自定义分类与平台', () => {
    const extraction = parseExtraction(
      '{"amount": "1.00", "category": "宠物", "platform": "山姆"}',
      { categories: ['餐饮', '宠物'], platforms: ['京东', '山姆'] },
    );
    expect(extraction.category).toBe('宠物');
    expect(extraction.platform).toBe('山姆');
  });

  it('无法解析时抛 ParseError', () => {
    expect(() => parseExtraction('没有 JSON')).toThrow(ParseError);
    expect(() => parseExtraction('{bad json}')).toThrow(ParseError);
  });
});

describe('normalizeRaw', () => {
  it('容忍类型不符与别名', () => {
    const extraction = normalizeRaw({
      is_payment: 'true',
      amount: 23.5,
      direction: '收入',
      merchant: '  某商户  ',
      category: '不存在的分类',
      platform: '微信',
      tx_time: '2026/9/8 9:05',
      note: 12345,
      confidence: '高',
    });
    expect(extraction.isPayment).toBe(true);
    expect(extraction.amountCents).toBe(2350);
    expect(extraction.direction).toBe('income');
    expect(extraction.merchant).toBe('某商户');
    expect(extraction.category).toBe('其他');
    expect(extraction.platform).toBe('微信');
    expect(extraction.txTime).toBe('2026-09-08T09:05');
    expect(extraction.note).toBe('12345');
    expect(extraction.confidence).toBe('high');
  });

  it('非付款截图标记', () => {
    const extraction = normalizeRaw({ is_payment: false, amount: null });
    expect(extraction.isPayment).toBe(false);
    expect(extraction.amountCents).toBeNull();
    expect(extraction.direction).toBe('expense');
    expect(extraction.category).toBe('其他');
  });

  it('平台不在列表内时置空，自定义平台可被接受', () => {
    expect(normalizeRaw({ amount: '1.00', platform: '某宝' }).platform).toBeNull();
    expect(
      normalizeRaw({ amount: '1.00', platform: '山姆' }, { platforms: ['京东', '山姆'] }).platform,
    ).toBe('山姆');
  });

  it('金额缺失时 is_payment 默认 false', () => {
    expect(normalizeRaw({}).isPayment).toBe(false);
    expect(normalizeRaw({ amount: '12.00' }).isPayment).toBe(true);
  });

  it('长备注截断', () => {
    const extraction = normalizeRaw({ amount: '1.00', note: 'x'.repeat(300) });
    expect(extraction.note?.length).toBe(120);
  });
});
