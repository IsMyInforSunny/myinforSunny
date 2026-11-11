import {compareRelativeBaseline} from '@/lib/relative-baselines';

type Props={body:string;title?:string};
export default function RelativeTopicComparison({body,title=''}:Props){
  if(!body.trim())return null;
  const comparison=compareRelativeBaseline(body,title);
  const metrics=[{label:'자극 표현 탐색',...comparison.fomo},{label:'근거 출처 명시',...comparison.attribution}];
  const unavailable=comparison.status==='unknown_topic'?'비교 주제 확인 필요':comparison.status==='incompatible'?'기준 버전 확인 필요':'비교 기사 부족';
  return <details className="studio-relative" open={comparison.status==='ready'}>
    <summary>같은 주제 기사와 비교 · {comparison.status==='ready'?comparison.topic!.label:unavailable}</summary>
    <dl>{metrics.map(metric=><div key={metric.label}><dt>{metric.label}</dt><dd>
      <strong>{metric.value??'—'}점</strong><span> · {metric.count}/{metric.total}문장</span>
      {metric.position&&<span> · 백분위 {metric.position.lower===metric.position.upper?metric.position.lower:`${metric.position.lower}–${metric.position.upper}`}{metric.position.ties!==null&&metric.position.ties>0?` · 같은 값 ${metric.position.ties}%`:''}</span>}
    </dd></div>)}</dl>
    {comparison.topic&&<p>{comparison.topic.label} 기사 {comparison.topic.n.toLocaleString()}건 · {comparison.topic.publisherCount}개 매체 · 본문 앞 {comparison.scopeCharacters.toLocaleString()}자</p>}
    <p>{comparison.articlePeriod.from}~{comparison.articlePeriod.through} · {comparison.articlePeriod.timeZone} · 기준 {comparison.version}</p>
    {comparison.status==='ready'?<p>문장 규칙으로 찾은 비율의 위치입니다. 매체별 기사 수를 같은 비중으로 반영하고, 동점은 가운데 순위로 표시합니다.</p>
      :<p>{comparison.status==='unknown_topic'?'기준 자료는 의대 정원·국민연금·최저임금·전기요금·주택 공급·원자력의 6개 주제를 포함합니다.':comparison.status==='incompatible'?'분석 규칙과 비교 기준의 버전이 달라 상대 위치를 표시할 수 없습니다.':'같은 주제 기사 100건 이상이 필요합니다.'}</p>}
  </details>;
}
