# NVIDIA DeepSeek local runtime

- Model: `deepseek-ai/deepseek-v4.1-flash`.
- Endpoint: `https://integrate.api.nvidia.com/v1/chat/completions`.
- Authentication: server environment `NVIDIA_API_KEY`, sent as Bearer authorization.
- Official reference: https://build.nvidia.com/deepseek-ai/deepseek-v4.1-flash
- Explicit selection: `AI_PROVIDER=nvidia`. Groq remains available when selected.
- User requested no application token limits. NVIDIA skips the Groq tokenizer/reservation, minute token budget, daily token budget, and output-token cap. Usage is recorded when returned. Provider defaults and account limits still apply.
- Keep one concurrent request, request frequency controls, cancellation, 180-second NVIDIA timeout, provider cooldown, JSON/schema validation, privacy checks, and no automatic retry/fallback.
- NVIDIA schema is included in the system message; only validated JSON is accepted. The published model's API schema does not document `response_format`, so no unsupported structured-output parameter is sent.
- Article length (2,000 characters) and processing-unit input limits remain product constraints; these are separate from token limits.

## Start locally

Use a shell that already has `NVIDIA_API_KEY` set. Do not place it in source, command arguments, or browser code.

```powershell
npm run build
npm run db:local
npm run start:nvidia
```

Default address: http://127.0.0.1:5184 . `PORT` can override the port. The launcher sets local provider and live-analysis settings, passes the existing secret by environment name, and modifies only the ignored generated Worker config. Local direct article retrieval uses approved publisher hosts. External search remains disabled.

The Windows development server currently fails in the Cloudflare/Vite startup layer with an `Unexpected token 'E'` JSON error. The built Worker served by Wrangler works, so `start:nvidia` is the verified local path.

## Verification

- TypeScript and production build passed.
- Full test suite: 773 passed; 13 real-API opt-in tests skipped.
- NVIDIA model-list request: HTTP 200; requested model listed.
- Real NVIDIA minimal generation: HTTP 200, exact requested model, normal `stop`, valid `{"ok":true}` result; about 115 seconds. Earlier 55/60-second attempts timed out.
- Local homepage, health, capabilities: HTTP 200; `aiProvider=nvidia`, `live=true`, `directFetch=true`.
- Browser verified URL input and NVIDIA DeepSeek transmission-consent text.
- Real local full-analysis request reached the NVIDIA adapter but timed out at 180 seconds. Full article-analysis success is not verified; the working minimal generation does not establish complete analysis success. No fallback or automatic retry was enabled.
- This change configures local execution only; the existing public deployment has not been changed.
