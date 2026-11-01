import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {demoAnalysis,demoVerification} from '../lib/fixtures';
import {currentResearch} from '../lib/current-research';
import CanvaDashboard from '../components/canva-dashboard';
import type {ResearchVerification} from '../lib/research-contract';

describe('현재 분석의 조사 결과 연결',()=>{
 it('명시적으로 연결된 동일 모드 결과만 보존하고 입력을 변경하지 않는다',()=>{
  const a=demoAnalysis('conflict'),v={...demoVerification('conflict'),parentAnalysisId:a.analysisId};
  const before=JSON.stringify(v);
  expect(currentResearch(a,[v,{...v,parentAnalysisId:undefined},{...v,parentAnalysisId:'old'},{...v,mode:'live'}])).toEqual([v]);
  expect(JSON.stringify(v)).toBe(before);
 });
 it('대시보드가 미연결·가상·이전 분석의 기사 링크를 추천하지 않는다',()=>{
  const a={...demoAnalysis('conflict'),mode:'live' as const};
  const v:ResearchVerification={...demoVerification('conflict'),mode:'live',parentAnalysisId:a.analysisId};
  const text='운영 시간을 연장해야 한다.';
  v.references=[{id:'web',url:'https://news.example/current-boundary',title:'연결 경계 시험 기사',text,provenance:'web_fetched',truncated:false}];
  v.checks=[];v.perspectiveChecks=[{referenceId:'web',positionText:text,stance:'supports_position',quote:text,start:0,end:text.length,explanation:'시험 자료'}];
  const render=(results:ResearchVerification[])=>renderToStaticMarkup(createElement(CanvaDashboard,{analysis:a,checks:[],researchResults:results,onEvidence:()=>{},onArticles:()=>{}}));
  expect(render([v])).toContain('https://news.example/current-boundary');
  for(const change of [{parentAnalysisId:undefined},{parentAnalysisId:'old'},{mode:'demo' as const}])expect(render([{...v,...change}])).not.toContain('https://news.example/current-boundary');
 });
});
