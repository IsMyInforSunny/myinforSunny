import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {articleFetchMessage,SupportedArticleHosts} from '../components/article-fetch-guidance';

describe('기사 링크 가져오기 안내',()=>{
 it.each([
  ['ARTICLE_FETCH_ROBOTS_DISALLOWED','이 페이지는 자동 수집을 허용하지 않습니다.'],
  ['ARTICLE_FETCH_ACCESS_RESTRICTED','로그인·구독 또는 접근 제한 기사는 링크로 가져오지 않습니다.'],
  ['ARTICLE_FETCH_TIMEOUT','기사 페이지 응답 시간이 초과됐습니다.'],
  ['ARTICLE_FETCH_HOST_RATE_LIMITED','이 매체에 대한 요청이 잠시 제한되었습니다.'],
 ])('구체적인 실패 코드 %s에 안내 문구를 붙인다',(code,message)=>{
  expect(articleFetchMessage(code,'서버 원문')).toContain(message);
 });
 it('알 수 없는 코드의 서버 안내는 유지한다',()=>{
  expect(articleFetchMessage('ARTICLE_FETCH_NEW_CODE','추출을 완료하지 못했습니다.')).toBe('추출을 완료하지 못했습니다.');
 });
 it('지원 매체를 펼쳐 보고 목록을 모르면 등록 여부를 단정하지 않는다',()=>{
  const markup=renderToStaticMarkup(createElement(SupportedArticleHosts,{hosts:['pressian.com','https://bad.example','ohmynews.com','pressian.com']}));
  expect(markup).toContain('링크 가져오기 지원 매체');expect(markup).toContain('프레시안');expect(markup).toContain('오마이뉴스');expect(markup.match(/pressian\.com/g)).toHaveLength(1);expect(markup).not.toContain('https://bad.example');
  const unknown=renderToStaticMarkup(createElement(SupportedArticleHosts,{}));
  expect(unknown).toContain('목록을 불러오지 못했습니다');
 });
 it('375px 이하 화면에서 지원 매체 문자열과 결과 카드가 그리드 밖으로 밀려나지 않도록 폭을 제한한다',()=>{
  const css=readFileSync(new URL('../app/article-studio.css',import.meta.url),'utf8');
  const mobile=css.slice(css.indexOf('@media (max-width: 720px)'));
  expect(mobile).toContain('.studio-layout { grid-template-columns: minmax(0, 1fr)');
  expect(mobile).toContain('.studio-supported-hosts,.studio-supported-host-list li { min-width: 0;');
  expect(mobile).toContain('.studio-card-grid { grid-template-columns: repeat(3, minmax(0, 1fr));');
  expect(css).toContain('.studio-supported-host-list li span { min-width: 0;');
  expect(css).toContain('overflow-wrap: anywhere;');
 });
 it('검증된 20개 호스트를 주소 수와 언론사 이름으로 표시하며 미등록 매체를 끼워 넣지 않는다',()=>{
  const hosts=['www.dailian.co.kr','www.newdaily.co.kr','biz.newdaily.co.kr','www.ohmynews.com','www.pressian.com','www.donga.com','www.yonhapnewstv.co.kr','www.hankyung.com','news.tvchosun.com','www.segye.com','www.seoul.co.kr','www.sisain.co.kr','www.mediaus.co.kr','www.redian.org','www.labortoday.co.kr','www.idomin.com','www.ksilbo.co.kr','www.newsis.com','www.kookje.co.kr','www.news1.kr'];
  const markup=renderToStaticMarkup(createElement(SupportedArticleHosts,{hosts}));
  expect(markup).toContain('20개 주소');expect(markup).toContain('연합뉴스TV');expect(markup).toContain('뉴데일리 경제판');expect(markup).toContain('경남도민일보');
  expect(markup).not.toContain('www.chosun.com');expect(markup.match(/<li>/g)).toHaveLength(20);
 });
});
