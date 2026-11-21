# 링크 가져오기 작업 상태

| 목표 | 완료 | 막힌 것 | 다음 작업 |
| --- | --- | --- | --- |
| 11-19 P2·P3 | 로컬 NVIDIA/연구20호스트 등록(기존6+신규14), 실제 기사 링크10/10 추출 성공; 실패 detail·붙여넣기·AMP·Daum 지원 | 실제 Daum 기사 성공 확인 미완료; C2 중단; 공개 목록은 사용자 지시로 유지 | 11-19 배포 때 검증된 목록 반영, Claude 화면 확인 |

## 확인된 사실 (2026-11-17)

- 11-16 밤 기존5곳·신규14곳 robots/실기사 추출 통과, 경제 뉴데일리를 포함해20호스트. DeepSeek 시작 경로는19호스트. 근거: `test-runs/link-audit-2026-11-16-night.json`.
- `check:links`15건: 실기사10/10 성공, 제외매체3건 차단, 포털 실패처리2건. 포털 처리용 주소는 실제 기사 성공으로 세지 않는다.
- `articleRestriction`은 메뉴를 제외한 본문300자 미만과 명확한 차단 문장에만 적용. JSON-LD·HTTP 제한은 유지하고 안전한 host/reason/detail 기록.
- SBS·채널A·참세상·뉴스민은 미등록. AI수집 제한 root는 denylist 유지. 공개 사이트 ALLOWED_RETRIEVAL_HOSTS는 11-17 사용자 결정으로 변경하지 않는다.
- 과거 상태는 `archive/link-fetch-status-before-2026-11-17.md`에 보존했다.