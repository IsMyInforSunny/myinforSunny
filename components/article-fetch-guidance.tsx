import type {ReactNode} from 'react';

const FETCH_MESSAGES:Record<string,string>={
 INVALID_URL:'HTTPS 기사 주소를 확인해 주세요.',
 BLOCKED_DESTINATION:'안전하지 않은 네트워크 주소로 연결되어 가져오기를 중단했습니다.',
 ROBOTS_DISALLOWED:'이 페이지는 자동 수집을 허용하지 않습니다. 기사 본문을 직접 붙여 넣어 주세요.',
 ROBOTS_AI_RESTRICTED:'이 매체는 AI 자동 수집을 제한하고 있어 링크로 가져오지 않습니다. 본문을 직접 붙여 넣어 주세요.',
 ACCESS_RESTRICTED:'로그인·구독 또는 접근 제한 기사는 링크로 가져오지 않습니다. 공개 본문을 직접 붙여 넣어 주세요.',
 NOT_HTML:'기사 페이지 형식이 아니어서 본문을 읽지 못했습니다. 본문을 직접 붙여 넣어 주세요.',
 TOO_LARGE:'기사 페이지가 허용 크기를 넘어 가져오지 못했습니다. 본문을 직접 붙여 넣어 주세요.',
 TIMEOUT:'기사 페이지 응답 시간이 초과됐습니다. 잠시 뒤 다시 시도하거나 본문을 붙여 넣어 주세요.',
 SCRIPT_RENDERED:'본문이 스크립트 실행 뒤에만 표시되어 가져오지 못했습니다. 본문을 직접 붙여 넣어 주세요.',
 TOO_SHORT:'추출된 본문이 100자보다 짧습니다. 기사 본문을 직접 붙여 넣어 주세요.',
 HOST_RATE_LIMITED:'이 매체에 대한 요청이 잠시 제한되었습니다. 기다린 뒤 다시 시도해 주세요.',
};

export function articleFetchMessage(code:string|undefined,fallback:string){
 const reason=code?.startsWith('ARTICLE_FETCH_')?code.slice('ARTICLE_FETCH_'.length):'';
 return FETCH_MESSAGES[reason]??fallback;
}

const PUBLISHER_NAMES:Record<string,string>={
 'pressian.com':'프레시안','www.pressian.com':'프레시안','m.pressian.com':'프레시안',
 'ohmynews.com':'오마이뉴스','www.ohmynews.com':'오마이뉴스',
 'dailian.co.kr':'데일리안','www.dailian.co.kr':'데일리안',
 'newdaily.co.kr':'뉴데일리','www.newdaily.co.kr':'뉴데일리','biz.newdaily.co.kr':'뉴데일리 경제판',
 'www.donga.com':'동아일보','www.yonhapnewstv.co.kr':'연합뉴스TV','www.hankyung.com':'한국경제',
 'news.tvchosun.com':'TV조선','www.segye.com':'세계일보','www.seoul.co.kr':'서울신문','www.sisain.co.kr':'시사IN',
 'www.mediaus.co.kr':'미디어스','www.redian.org':'레디앙','www.labortoday.co.kr':'매일노동뉴스',
 'www.idomin.com':'경남도민일보','www.ksilbo.co.kr':'경상일보','www.newsis.com':'뉴시스',
 'www.kookje.co.kr':'국제신문','www.news1.kr':'뉴스1',
};

export function SupportedArticleHosts({hosts,children}:{hosts?:string[];children?:ReactNode}){
 const clean=[...new Set((hosts??[]).map(host=>host.trim().toLowerCase()).filter(host=>/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(host)))].sort();
 return <details className="studio-supported-hosts">
  <summary>링크 가져오기 지원 매체{clean.length?` · ${clean.length}개 주소`:''}</summary>
  {clean.length?<ul className="studio-supported-host-list">{clean.map(host=><li key={host}><strong>{PUBLISHER_NAMES[host]??host}</strong><span>{host}</span></li>)}</ul>:<p>현재 서버 설정에 등록된 매체가 없거나 목록을 불러오지 못했습니다.</p>}
  {children??<p>표시된 주소도 robots·AI 수집 제한·공개 접근 여부를 확인해 가져옵니다. 로그인·구독 제한은 우회하지 않습니다.</p>}
 </details>;
}
