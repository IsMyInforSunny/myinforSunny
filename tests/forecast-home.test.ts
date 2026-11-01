import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';

vi.mock('../components/workbench', () => ({
  default: () => createElement('section', {'data-testid': 'analysis-workbench'}, 'Live workbench'),
}));

import ForecastHome from '../components/forecast-home';
import HomePage from '../app/page';
import AnalyzePage from '../app/analyze/page';

describe('Canva-based application home', () => {
  it('makes the analysis workbench the homepage rather than a marketing preview', () => {
    const html = renderToStaticMarkup(createElement(ForecastHome));
    expect(html).toContain('forecast-app');
    expect(html).toContain('<h1>내 정보 맑음?</h1>');
    expect(html).toContain('forecast-wordmark');
    expect(html).not.toContain('forecast-title');
    expect(html).not.toContain('오늘, 당신의 정보는');
    expect(html).toContain('data-testid="analysis-workbench"');
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('href="/methodology"');
    expect(html).not.toContain('iframe');
  });

  it('serves the same application shell at home and /analyze', () => {
    expect(renderToStaticMarkup(createElement(HomePage)))
      .toBe(renderToStaticMarkup(createElement(AnalyzePage)));
  });
});
