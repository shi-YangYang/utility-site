export type Direction = 'expense' | 'income';

export interface RecordDraft {
  amountCents: number;
  direction: Direction;
  merchant: string | null;
  category: string;
  platform: string | null;
  txTime: string;
  note: string | null;
  imagePath: string | null;
  imageHash: string | null;
}

export interface LedgerRecord extends RecordDraft {
  id: number;
  createdAt: string;
  updatedAt: string;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface LlmExtraction {
  isPayment: boolean;
  amountCents: number | null;
  direction: Direction;
  merchant: string | null;
  category: string;
  platform: string | null;
  txTime: string | null;
  note: string | null;
  confidence: Confidence | null;
}
