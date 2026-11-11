'use client';

import {useEffect, useState} from 'react';
import {ArrowUpRight, Newspaper} from 'lucide-react';
import type {Analysis} from '@/lib/contracts';
import type {NewsResult, RelatedArticle} from '@/lib/news-contract';

type Props = {analysis: Analysis; stale: boolean};
type SearchState = {analysisId: string; articles: RelatedArticle[]; status: 'loading' | 'completed' | 'failed'};

export function CollectedArticleCards({articles, message}: {articles: RelatedArticle[]; message: string}) {
  return <div className="studio-card-grid" aria-label="수집 기사 후보">
    {articles.slice(0, 3).map(article => <a key={article.url} href={article.url} target="_blank" rel="noopener noreferrer" className="studio-article-card">
      <span>수집 기사 · 본문 대조 전</span>
      <h3>{article.title}</h3>
      <p>{article.publishedAt && Number.isFinite(Date.parse(article.publishedAt))
        ? <time dateTime={article.publishedAt}>{new Date(article.publishedAt).toLocaleDateString('ko-KR', {timeZone: 'Asia/Seoul'})}</time>
        : '발행일 확인 필요'} · 본문과 입장은 자료 대조에서 확인해 주세요.</p>
      <footer>{article.publisherDomain}<ArrowUpRight size={14}/></footer>
    </a>)}
    {Array.from({length: Math.max(0, 3 - articles.length)}, (_, index) => <div key={index} className="studio-article-card is-empty">
      <Newspaper size={23} strokeWidth={1.3}/><p>{message}</p>
    </div>)}
  </div>;
}

export default function CollectedArticles({analysis, stale}: Props) {
  const query = analysis.searchSuggestions?.[0]?.query;
  const enabled = analysis.mode === 'live' && !stale && !!query;
  const [state, setState] = useState<SearchState | null>(null);
  useEffect(() => {
    setState(null);
    if (!enabled || !query) return;
    const controller = new AbortController();
    setState({analysisId: analysis.analysisId, articles: [], status: 'loading'});
    void fetch('/api/article-index', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query}), signal: controller.signal})
      .then(async response => {
        if (!response.ok) throw new Error('index_unavailable');
        return await response.json() as NewsResult;
      })
      .then(result => {
        if (!controller.signal.aborted) setState({analysisId: analysis.analysisId,
          articles: result.provider === 'local_index' && Array.isArray(result.articles) ? result.articles.slice(0, 3) : [], status: 'completed'});
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({analysisId: analysis.analysisId, articles: [], status: 'failed'});
      });
    return () => controller.abort();
  }, [analysis.analysisId, enabled, query]);
  const current = enabled && state?.analysisId === analysis.analysisId ? state : null;
  const message = stale ? '입력이 변경되어 이전 검색 후보를 표시하지 않습니다.'
    : !enabled ? '분석 결과의 검색 핵심어가 준비되면 수집 기사를 찾습니다.'
    : !current || current.status === 'loading' ? '수집 기사에서 관련 후보를 찾고 있습니다.'
    : current.status === 'failed' ? '수집 기사 목록을 불러오지 못했습니다.'
    : '수집된 최근 기사에서 검색어에 맞는 후보를 찾지 못했습니다.';
  return <CollectedArticleCards articles={current?.articles ?? []} message={message}/>;
}
