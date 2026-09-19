import type { LlmConfig } from './types';

export const MISSING_CONFIG_MESSAGE =
  'LLM 配置缺失：请在项目根目录的 .env 中配置 EXPO_PUBLIC_LLM_BASE_URL / EXPO_PUBLIC_LLM_API_KEY / EXPO_PUBLIC_LLM_MODEL，然后重新启动（打包的 App 需要重新打包）。';

export function getLlmConfig(): LlmConfig | null {
  const baseUrl = process.env.EXPO_PUBLIC_LLM_BASE_URL;
  const apiKey = process.env.EXPO_PUBLIC_LLM_API_KEY;
  const model = process.env.EXPO_PUBLIC_LLM_MODEL;
  if (!baseUrl || !apiKey || !model) return null;
  return {
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    model: model.trim(),
  };
}
