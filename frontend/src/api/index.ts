import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000, // 增加到2分钟，因为第一次搜索需要加载模型
});

// 类型定义
export interface StarPoint {
  x: number;
  y: number;
  z: number;
  domain: string;
  chunk_id: string;
  content: string;
  source: string;
  size: number;
  brightness: number;
}

export interface SearchResult {
  bm25: Array<{ chunk_id: string; score: number }>;
  knn: Array<{ chunk_id: string; score: number }>;
  rrf_top5: Array<{ chunk_id: string; rrf_score: number }>;
  reranker_final: { chunk_id: string; rerank_score: number } | null;
}

export interface EvalData {
  query: string;
  results: string[];
  is_correct: boolean;
  current_metrics: Record<string, number>;
  cumulative_metrics: Record<string, number>;
  total_samples: number;
  current_step: number;
  retrieved_ids: string[];
  correct_ids: string[];
  ranks: number[];
}

// API 方法
export const getStarData = async (): Promise<{ count: number; data: StarPoint[] }> => {
  const response = await api.get('/api/star-data');
  return response.data;
};

export const search = async (query: string): Promise<SearchResult> => {
  const response = await api.post('/api/search', { query });
  return response.data;
};

export const getEvalData = async (domain: string, step: number): Promise<EvalData> => {
  const response = await api.get(`/api/eval/${domain}`, { params: { step } });
  return response.data;
};

export const getConfig = async () => {
  const response = await api.get('/api/config');
  return response.data;
};

export default api;
