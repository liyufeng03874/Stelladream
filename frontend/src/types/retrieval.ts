export type RetrievalStageKey = 'bm25' | 'knn' | 'rrf' | 'final';

export interface RetrievalStageInsight {
  key: RetrievalStageKey;
  label: string;
  hit: boolean;
  rank: number | null;
  total: number;
  score: number | null;
  scoreLabel: string;
}

export interface RetrievalInsight {
  query: string;
  isCurrentFinal: boolean;
  hitStageCount: number;
  summary: string;
  stages: RetrievalStageInsight[];
}
