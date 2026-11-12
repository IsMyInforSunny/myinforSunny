# Direct DeepSeek API 전환 상태

사용자 요청에 따라 공식 DeepSeek Chat Completions API 어댑터를 추가했다. 이 기능은 NVIDIA NIM 어댑터와 별개이며 공식 키 이름은 `DEEPSEEK_API_KEY`, 기본 모델은 `deepseek-flash`다.

공식 API는 토큰 사용량에 따라 과금된다. 무료 전용·유료 활성화 확인 플래그가 모두 명시적으로 바뀌기 전에는 제공자 준비 상태와 실시간 분석을 활성화하지 않는다.

현재 확인 결과:

- Windows 프로세스/사용자 환경변수에는 `NVIDIA_API_KEY`가 있고 `DEEPSEEK_API_KEY`는 없다.
- 호스팅 Site 환경변수 이름에는 비밀값을 출력하지 않고 점검했으며 `GROQ_API_KEY`와 `NVIDIA_API_KEY`만 있다. `DEEPSEEK_API_KEY`는 없다.
- NVIDIA 키는 NVIDIA API 인증용이므로 DeepSeek 공식 도메인에 전달하지 않았다.
- 운영 Site 제공자/비용 플래그는 기존 `nvidia`, `FREE_ONLY=true`, `ENABLE_PAID_PROVIDER=false`, `PAID_ACTIVATION_CONFIRMED=false` 상태로 보존했다.

실제 공식 API 연결 검증에는 공식 DeepSeek 키를 Site secret `DEEPSEEK_API_KEY`로 등록하고, 비용을 검토한 뒤 유료 플래그를 활성화해야 한다. 어댑터는 공식 `https://api.deepseek.com/chat/completions`, `deepseek-flash`, JSON Output, 응답 사용량 기록, 스트림 검증을 사용한다. 사용자 데이터는 JSON Schema 검증 전까지 분석 결과로 표시하지 않는다.
