import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import ReviewSection from '../components/review-section';

describe('page review sections', () => {
  it('renders detailed review as a labelled page section', () => {
    const html = renderToStaticMarkup(createElement(ReviewSection, {
      open: true, title: '분석근거', onClose: () => {}, children: '원문 근거'
    }));
    expect(html).toContain('<section');
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('원문 근거');
    expect(html).not.toContain('<dialog');
    expect(html).not.toContain('aria-modal');
    expect(html).not.toMatch(/<section[^>]*\shidden=/);
  });

  it('keeps analysis content mounted while its section is closed', () => {
    const html = renderToStaticMarkup(createElement(ReviewSection, {
      open: false, title: '분석근거', onClose: () => {}, children: '현재 분석의 자료 조사'
    }));
    expect(html).toMatch(/<section[^>]*\shidden=/);
    expect(html).toContain('현재 분석의 자료 조사');
  });
});

