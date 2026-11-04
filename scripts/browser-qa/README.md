# 웹사이트 브라우저 회귀 검사

개발 서버가 `http://127.0.0.1:5173`에서 예시 모드로 실행 중일 때 사용한다. 실제 키나 외부 서비스 활성화는 필요 없다. 합성 입력·로컬 예시 API만 사용하며 `research.js`와 `coordinates.js`는 브라우저에서 응답을 가로채는 모의 시험이다. `coordinates.js`는 별도 검사 탭의 시간만 앞당긴다. 제품의 요청 간격이나 예산 설정은 변경하지 않는다.

```powershell
npx --yes --package @playwright/cli playwright-cli -s=site-qa open http://127.0.0.1:5173 --browser=chrome
npx --yes --package @playwright/cli playwright-cli -s=site-qa snapshot
npx --yes --package @playwright/cli playwright-cli -s=site-qa run-code --filename scripts/browser-qa/state.js
npx --yes --package @playwright/cli playwright-cli -s=site-qa run-code --filename scripts/browser-qa/example-navigation.js
npx --yes --package @playwright/cli playwright-cli -s=site-qa run-code --filename scripts/browser-qa/research.js
npx --yes --package @playwright/cli playwright-cli -s=site-qa run-code --filename scripts/browser-qa/coordinates.js
npx --yes --package @playwright/cli playwright-cli -s=site-qa run-code --filename scripts/browser-qa/popup.js
npx --yes --package @playwright/cli playwright-cli -s=site-qa run-code --filename scripts/browser-qa/exports.js
npx --yes --package @playwright/cli playwright-cli -s=site-qa run-code --filename scripts/browser-qa/fomo-boundary.js
npx --yes --package @playwright/cli playwright-cli -s=site-qa run-code --filename scripts/browser-qa/dashboard-states.js
npx --yes --package @playwright/cli playwright-cli -s=site-qa run-code --filename scripts/browser-qa/scores.js
npx --yes --package @playwright/cli playwright-cli -s=site-qa close
```

검사 화면의 예시 입력·동의·임시 동작 기록을 변경하므로 별도 검사 세션을 사용한다. 캡처와 다운로드는 Git에서 제외된 `output/playwright/` 또는 Playwright CLI의 로컬 출력 폴더에 남는다.

| 파일 | 확인 범위 |
| --- | --- |
| `state.js` | 새 분석·초기화 시 내보내기 선택 해제, 비활성 대조 차단, 수정된 입력의 좌표 경고 |
| `consent-validation.js` | 본문·댓글·명제·참고자료 수정과 원상복구 시 전송 재동의, 미동의 요청 차단, 가로챈 422 검증 필드 안내, 선택 글 초기화 |
| `pending-readiness.js` | 현재 열린 사이트의 origin에서 모의 분석으로 산출 대기 이유, 기사 연결 준비/사용 가능 상태, 자극 점수 보존과 375px 화면을 확인. 실제 text 분석 요청은 가로챔 |
| `example-navigation.js` | 예시 요청 취소·초기화 후 좌표창 재개방 방지, 정상 완료 시 이동, 수동 대조 본문 안내 |
| `research.js` | 분석·조사 취소, 늦은 응답 무시, 재시작 동의, 입력 변경·복원, 메인·내보내기 집계 일치, 한도 소진 안내 |
| `direct-evidence.js` | 검색 없이 직접 URL 근거 대조, 주소 수정 후 재동의, 공통 검토·내보내기 연결, 취소 뒤 늦은 응답 무시, 375px 화면. 모든 text 분석·조사는 모의 API |
| `coordinates.js` | 직접 지정한 명제, 사실 건수와 의견 구분, 현재 조사에서 추천·매체 좌표 연결, 매체별 3개·2곳 기준, 모바일 |
| `popup.js` | 실제 팝업, 원문 강조, 방향키·Home·End 탭 조작, 모바일 제목·닫기 버튼과 가로 넘침 |
| `exports.js` | 실제 기본·상세 JSON 다운로드 성공, 미리보기와 파일 일치, 원문·자료 포함 선택 구분 |
| `fomo-boundary.js` | 긴 문장의 처리 경계에 걸친 FOMO 표현 집계·원문 밑줄·설명 일치, 본문과 자연 문장 분모 보존 |
| `dashboard-states.js` | 모의 부분 분석·이전 입력 배지와 보드 위 안내, 근거 접근·Esc 포커스 복원, 320/375/768/1280px |
| `scores.js` | 세 축의 점수·분모와 JSON 일치, 가상 자료의 편향 보류, 원문 opt-in, 이전 입력 내보내기 표시, 모바일 |

타입·웹사이트 단위 테스트·빌드를 웹사이트 전용 기록으로 남기려면 다음 명령을 실행한다. 실행기·코딩 제공자 설정의 개인 테스트를 제외한다. 실제 API opt-in 시험은 기본적으로 건너뛴다.

```powershell
node scripts/check-record.mjs --website-only
```

이 검사들의 통과는 실제 기사 취득, 모델 해석 정확도, 독립 평가자의 평가나 공개 배포 성공을 뜻하지 않는다.
