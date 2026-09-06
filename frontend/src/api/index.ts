import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

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
  doc_id?: string;
  chunk_index?: number;
  source_path?: string;
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
  dataset?: string;
  run?: string;
  index?: string;
  method?: string;
  summary?: Record<string, number>;
  metric_keys?: string[];
  query_id?: string;
  query: string;
  results: string[];
  is_correct: boolean;
  current_metrics: Record<string, number>;
  cumulative_metrics: Record<string, number>;
  total_samples: number;
  current_step: number;
  retrieved_ids: string[];
  parent_ids?: string[];
  grades?: number[];
  correct_ids: string[];
  ranks: number[];
}

export interface EvalSampleSummary {
  step: number;
  query_id: string;
  query: string;
  retrieved_count: number;
  relevant_count: number;
  first_relevant_rank: number | null;
  hit_key?: string | null;
  hit?: boolean | null;
  ndcg_key?: string | null;
  ndcg?: number | null;
  metrics: Record<string, number>;
}

export interface EvalSamplesResponse {
  dataset?: string;
  run?: string;
  index?: string;
  method?: string;
  metric_keys: string[];
  total_samples: number;
  samples: EvalSampleSummary[];
}

// API 方法
export const getStarData = async (): Promise<StarPoint[]> => {
  const response = await api.get('/api/star-data');
  // 后端返回 { count, data } 或直接数组，统一提取
  if (Array.isArray(response.data)) {
    return response.data;
  }
  return response.data.data || response.data.points || [];
};

export const search = async (query: string): Promise<SearchResult> => {
  const response = await api.post('/api/search', { query });
  return response.data;
};

export const getEvalData = async (domain: string, step: number): Promise<EvalData> => {
  const response = await api.get(`/api/eval/${domain}`, { params: { step } });
  return response.data;
};

export const getEvalSamples = async (domain: string): Promise<EvalSamplesResponse> => {
  const response = await api.get(`/api/eval/${domain}/samples`);
  return response.data;
};

export const getConfig = async () => {
  const response = await api.get('/api/config');
  return response.data;
};

export default api;
