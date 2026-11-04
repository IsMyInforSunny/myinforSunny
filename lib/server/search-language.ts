import type {RuntimeConfig} from './config';

const KOREAN_QUERY='한국어 기관명·인명·자료명·핵심 표현을 유지하고 필요한 영문 고유명사와 숫자는 함께 쓸 수 있다. 억지로 영문으로 번역하지 않는다.';

/** GDELT indexes English translations. Select query language in the existing
 * model request, without another translation call or altering the source text. */
export function searchLanguagePrompt(prompt:string,config:RuntimeConfig):string{
  if((config.NEWS_PROVIDER??'gdelt')!=='gdelt')return prompt;
  return prompt.replace(KOREAN_QUERY,'검색 제공자 GDELT는 한국어 기사의 영문 번역 색인을 검색하므로 query는 의미를 보존한 영문 핵심어로 작성한다. 기관·인명은 확인 가능한 영문 명칭만 사용하고 모르면 원문 고유명사를 유지한다. 수치·시점과 비교 명제의 의미를 바꾸지 않는다. label과 모든 설명은 한국어로 작성한다.');
}
