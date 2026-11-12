import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import artifact from '../lib/data/stance-model.json';
import training from '../lib/data/stance-model-status.json';
import ContentStanceComparison from '../components/content-stance-comparison';
import {canonicalStanceProposition,parseStanceModel,stanceTopicRelevant} from '../lib/stance-model';

describe('content stance readiness reporting',()=>{
  it('정책의 공통 명제를 유지하고 비정책·다른 분야에 정책 질문을 강제하지 않는다',()=>{
    expect(canonicalStanceProposition('노동계가 최저임금 인상을 요구했다.')).toBe('최저임금을 인상해야 한다.');
    expect(canonicalStanceProposition('아파트 화재 현장에서 구조 작업이 이어졌다.')).toBeUndefined();
    expect(canonicalStanceProposition('새 칫솔모의 압전 기술을 개발했다.')).toBeUndefined();
  });
  it('keeps the research model inactive and reports the real current blockers',()=>{
    expect(training.ready).toBe(false);
    expect(training.annotatedArticleCount).toBe(160);
    expect(training.relevantArticleCount).toBe(102);
    expect(training.classCounts).toMatchObject({support:17,oppose:7,non_directional:57});
    expect(training.humanEvaluationCount).toBe(0);
    expect(training.blockers).toContain('usage_review_pending');
    expect(parseStanceModel(artifact)).toBeNull();
  });

  it('shows the measured agreement and zero human evaluations without inventing a score',()=>{
    const html=renderToStaticMarkup(createElement(ContentStanceComparison,{
      body:'최저임금 인상에 대해 사업자와 노동자 단체의 입장이 엇갈린다.',
      title:'최저임금 논의'}));
    expect(html).toContain('AI 검토 160건 중 명제 관련 102건');
    expect(html).toContain('AI 라벨 재현 macro-F1 56.6%');
    expect(html).toContain('찬성 재현율 16.7%');
    expect(html).toContain('반대 50.0%');
    expect(html).toContain('사람 평가 0건');
    expect(html).not.toContain('모델 좌표');
  });

  it('does not treat unrelated stories as policy-stances',()=>{
    expect(stanceTopicRelevant('아파트 화재 현장에서 구조 작업이 이어졌다.','housing_supply')).toBe(false);
    expect(stanceTopicRelevant('정부는 주택 공급을 확대해야 한다고 밝혔다.','housing_supply')).toBe(true);
    const html=renderToStaticMarkup(createElement(ContentStanceComparison,{body:'빙하가 빠르게 녹고 해수면이 상승한다.',title:'기후 변화'}));
    expect(html).toContain('6개 정책 명제만 대상');
  });
});
