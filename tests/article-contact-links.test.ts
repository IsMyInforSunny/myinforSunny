import {describe,expect,it} from 'vitest';
import {extractArticle} from '../lib/server/article-extraction';
import {containsContactInfo} from '../lib/privacy';

describe('article contact links',()=>{
 it('excludes reporter contact links while retaining article paragraphs',()=>{
  const paragraph='연구진은 실험 결과와 한계를 공개 자료에 제시했다. 후속 연구에서는 장기간 안전성을 검증할 예정이다. '.repeat(3);
  const html=`<html><head><title>Research</title></head><body><article itemprop="articleBody"><p>${paragraph}</p><p>Reporter <a href="mailto:reporter@example.com">reporter@example.com</a><a href="tel:01012345678">01012345678</a></p></article></body></html>`;
  const result=extractArticle(html,'https://news.example/article');
  expect(result?.text).toContain(paragraph.trim());
  expect(result?.text).not.toContain('reporter@example.com');
  expect(result?.text).not.toContain('01012345678');
  expect(containsContactInfo(result?.text??'')).toBe(false);
 });
 it('preserves contact text inside the article for the existing privacy check',()=>{
  const html='<html><head><title>Research</title></head><body><article itemprop="articleBody"><p>문의는 reporter@example.com으로 보냈다고 기사 본문에 명시했다. 연구 결과를 확인하기 위해 여러 자료를 대조했다.</p></article></body></html>';
  expect(containsContactInfo(extractArticle(html,'https://news.example/article')?.text??'')).toBe(true);
 });
});
