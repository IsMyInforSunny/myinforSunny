import {describe, expect, it} from 'vitest';
import {SOUTH_KOREA_PUBLIC_TRUST_PRIOR_2025 as prior} from '../lib/public-trust-prior';

describe('Reuters 2025 Korea public-trust prior', () => {
  it('uses the reported Trust% divided by 100 for each comparable outlet host', () => {
    expect(Object.fromEntries(prior.weights.map(w => [w.publisher, w.value]))).toEqual({
      'ichannela.com': 0.43,
      'chosun.com': 0.40,
      'donga.com': 0.41,
      'hani.co.kr': 0.45,
      'joongang.co.kr': 0.40,
      'news.jtbc.co.kr': 0.59,
      'news.kbs.co.kr': 0.48,
      'khan.co.kr': 0.43,
      'imnews.imbc.com': 0.61,
      'mbn.co.kr': 0.46,
      'news.sbs.co.kr': 0.54,
      'news.tvchosun.com': 0.42,
      'yonhapnewstv.co.kr': 0.52,
      'ytn.co.kr': 0.55,
    });
  });

  it('documents the CSV, perception caveat, small-difference caveat, and Yonhap News TV distinction per weight', () => {
    for (const weight of prior.weights) {
      expect(weight.evidence).toContain('https://datawrapper.dwcdn.net/3sOWE/2/data.csv');
      expect(weight.evidence).toContain('이용자 신뢰 인식');
      expect(weight.evidence).toContain('정확도');
      expect(weight.evidence).toContain('2%p 이하');
      expect(weight.evidence).toContain('Yonhap News TV');
      expect(weight.evidence).toContain('yna.co.kr');
      expect(weight.evidence).toContain('yonhapnewstv.co.kr');
    }
  });

  it('keeps Yonhap News TV distinct from Yonhap News and applies MBC raw value', () => {
    expect(prior.weights.find(w => w.publisher === 'imnews.imbc.com')?.value).toBe(0.61);
    expect(prior.weights.find(w => w.publisher === 'news.jtbc.co.kr')?.value).toBe(0.59);
    expect(prior.weights.some(w => w.publisher === 'yna.co.kr')).toBe(false);
    expect(prior.weights.find(w => w.publisher === 'yonhapnewstv.co.kr')?.value).toBe(0.52);
  });
});
