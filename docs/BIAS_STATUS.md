# 편향 기능 작업 상태

| 목표 | 완료 | 막힌 것 | 다음 할 일 |
| --- | --- | --- | --- |
| CURRENT_PLAN 11-16 밤 | 본문 제한 오탐·detail 수정, 예산 테스트15초, AGENTS 정리·보관, 연구명령 추가, 기존5곳+신규14곳 실기사 추출 통과. check:full 1106tests·타입·빌드·diff 통과 | 실기사6회 취득6/6·인용6/6·본문4/6; 원전 입장근거/최저임금 출력제한 잔여 | Lightning450건 진행·21:35:56 이후 Llama5건 재시험·필요시 Groq평가90건 |

## 확인된 사실 (2026-11-16)

- Lightning 단독 백그라운드 PID26096,21:13 기준13/450 완료, 요청 진행 중. 기존 성공5건 보존. 진행 파일 `.sites-runtime/paired-voice-labels-20261116/lightning-progress.local.json`; 20초 간격·300초 제한·체크포인트. 학습360건은 단일 모델 라벨로 구분한다.
- Llama 마지막503 종료는 20:35:56 KST. 21:35:56 이후 5건 한 번 재시험하는 로컬 supervisor PID12984가 대기한다. 계속503일 때만 Groq 평가90건을 수행한다.
- Groq 호출 전 적용 한도: 저장된 canonical `.dev.vars`의 confirmed RPM30·RPD1000·TPM8000·TPD200000(11-15 계정 설정 관측). 내부 보호 TPM7000·TPD120000·요청예약6500, 간격61초, 하루 예약 소진 시 중단/다음날 재개,429 자동재시도 없음. 키는 INFORCAST_GROQ_KEY_FILE 참조만 메모리에서 읽는다. 현재 공개 사이트 NVIDIA이므로 Groq 사이트 몫은 공유하지 않는다.90건 완료를 하루에 보장하지 않는다.
- 공개 Sites 환경 revision11 조회: production 26호스트, 로컬 기본6호스트. 로컬에만 있는 값: biz.newdaily.co.kr. 공개에만 있는 값: ichannela.com,www.ichannela.com,chosun.com,www.chosun.com,hani.co.kr,www.hani.co.kr,joongang.co.kr,www.joongang.co.kr,news.jtbc.co.kr,news.kbs.co.kr,khan.co.kr,www.khan.co.kr,imnews.imbc.com,mbn.co.kr,www.mbn.co.kr,news.sbs.co.kr,news.tvchosun.com,yonhapnewstv.co.kr,www.yonhapnewstv.co.kr,ytn.co.kr,www.ytn.co.kr. AI제한 root는 로컬 denylist 유지. 배포 때 검증된 최종 목록으로 맞춘다. 이번 작업은 production 설정 변경 없음.

## 차단 항목 (세 줄)

- 막힘: Llama 서비스503과 매체20곳 목표는 아직 미해결이다.
- 확인한 사실: 기존 450건 manifest 검증 통과, Lightning 파일럿5/5, Llama5/5 HTTP503; 재시작 프로세스는 실제 진행 파일로 확인한다.
- 다음: 승인된 재시험·평가 fallback을 checkpoint로 진행(권장); provider가 계속 실패하면 해당 부분만 보류하고 다른 검사·커밋을 완료한다.


## 최종 로컬 목록과 공개 설정 차이

- Sites 환경 revision 11: 공개 26호스트 / 로컬 20호스트. 공개에만: ichannela.com,www.ichannela.com,chosun.com,www.chosun.com,hani.co.kr,www.hani.co.kr,joongang.co.kr,www.joongang.co.kr,news.jtbc.co.kr,news.kbs.co.kr,khan.co.kr,www.khan.co.kr,imnews.imbc.com,mbn.co.kr,www.mbn.co.kr,news.sbs.co.kr,yonhapnewstv.co.kr,ytn.co.kr,www.ytn.co.kr. 로컬에만: biz.newdaily.co.kr,www.hankyung.com,www.segye.com,www.seoul.co.kr,www.sisain.co.kr,www.mediaus.co.kr,www.redian.org,www.labortoday.co.kr,www.idomin.com,www.ksilbo.co.kr,www.newsis.com,www.kookje.co.kr,www.news1.kr. 이 최종 차이는 위 6호스트 기준의 초기 조회를 대체한다. 공개 설정은 그대로이며 배포 시 반영한다.

- 18곳 재점검: 신규14곳 통과, 기존5곳 통과. NVIDIA/연구 기본 허용20호스트(경제 뉴데일리 포함), DeepSeek19호스트. SBS·채널A·참세상·뉴스민은 미등록. check:links15건: 실기사10건 성공·차단3건·포털 실패처리2건; 실제 포털 기사 성공 근거는 미확보.

## 실제 기사 반복 분석 결과

| 기사 쟁점 | 횟수 | 취득 | 본 분석 | 인용 분류 | BODY_POSITION_UNAVAILABLE | 시간(초) |
| --- | --- | --- | --- | --- | --- | --- |
| 의대 정원 | 2 | 2/2 | 2/2 | 2/2·18문장 | 0/2 | 9.2, 8.9 |
| 원전 확대 | 2 | 2/2 | 2/2 | 2/2·36문장 | 2/2 | 27.2, 129.6 |
| 최저임금 | 2 | 2/2 | 0/2·output_limit | 2/2·14문장 | 2/2 | 47.0, 48.5 |

- 실제 URL 취득 후 현재 소스에서 NVIDIA 분석, 캐시 미사용. 취득6/6·본문4/6·인용6/6, BODY_POSITION_UNAVAILABLE4/6. 초기 연구 서버 빌드는 dist 잠금으로 실패했지만 이후 잠금 서버 종료 후 check:full 빌드는 통과했다. 이번6회는 연구 SVM 주입 없는 소스 검사이므로 모두 partial 상태를 유지한다. JSON: `test-runs/article-analysis-separation-2026-11-16.json`.
- 남은 문제: 원전2회 본문입장 근거 미확인, 최저임금2회 본문 생성 출력 길이 제한. 인용 결과는 모두 보존됐으며 완전 분석 성공으로 주장하지 않는다.
- 최종 검증: check:full 타입검사·전체1106통과/13skip·빌드·diff 통과; 이후 허용 목록·네이티브 로더 변경은 check:quick·450manifest audit·모듈import(API0) 통과. 공개 배포/production설정 변경 없음.