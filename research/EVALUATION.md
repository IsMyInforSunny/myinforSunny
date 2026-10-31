# 독립 사람 평가 준비

비정치적인 학교생활 가상 자료 40개입니다. 예시·프롬프트 개발에 사용한 10사례와 별도 관리합니다. 작성 주체는 AI이며 사람의 정답이나 실제 조사 자료가 아닙니다. 두 평가자는 상대방 라벨이나 LLM 결과를 보기 전에 각각 CSV를 작성합니다.

- `expression_status`: flagged / clear / undetermined. 기준은 제품의 6가지 자극적 표현이며 인용·반어 맥락을 고려합니다.
- `claim_kind`: factual / opinion / undetermined / none. factual은 확인 가능한 형태이며 참이라는 뜻이 아닙니다. 출처 없는 수치도 factual일 수 있습니다. 이 파일럿은 각 입력의 중심 주장 하나를 평가합니다.
- `reference_relation`: supported / contradicted / conflicting / insufficient / unchecked / not_applicable. 참고자료가 없으면 unchecked, 사실 주장이 아니면 not_applicable입니다. 시점 불일치는 supported로 확정하지 않습니다.
- `notes`: 라벨 근거와 모호한 부분을 적습니다. 조정 전 원본을 보존하고, 불일치를 합의하더라도 조정 전 사람 일치도를 보고합니다.

준비: `python research/prepare-evaluation.py` (기존 라벨 양식을 덮어쓰므로 평가 시작 후 실행하지 않습니다).

비교: `python research/compare-evaluation.py --reviewer1 research/reviewer-1.csv --reviewer2 research/reviewer-2.csv --predictions research/runs/predictions.csv --output research/runs/comparison.md`

LLM 예측 CSV는 같은 열과 case_id를 사용하며 실제 실행 결과만 적습니다. 실행 실패·복수 중심 주장·불명확한 추출은 undetermined로 기록하고 오류를 notes에 적습니다. 미실행을 정답으로 대체하지 않습니다. 이 표는 소규모 중심 주장 파일럿이며 기사 전체 정확도를 뜻하지 않습니다. 기존 문서의 동결 문장 60개·자료 관계 20쌍 평가는 추가 자료가 필요합니다.
