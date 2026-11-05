# NVIDIA DeepSeek local runtime

- Model: `deepseek-ai/deepseek-v4.1-flash`.
- Endpoint: `https://integrate.api.nvidia.com/v1/chat/completions`.
- Authentication: server environment `NVIDIA_API_KEY`, sent as Bearer authorization.
- Official reference: https://build.nvidia.com/deepseek-ai/deepseek-v4.1-flash
- Explicit selection: `AI_PROVIDER=nvidia`. Groq remains available when selected.
- User requested no application token limits. NVIDIA skips the Groq tokenizer/reservation, minute token budget, daily token budget, and output-token cap. Usage is recorded when returned. Provider defaults and account limits still apply.
- Keep one concurrent request, request frequency controls, cancellation, a 600-second total NVIDIA timeout and 180-second idle-stream timeout, provider cooldown, JSON/schema validation, privacy checks, and no automatic retry/fallback.
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

## Real article latency diagnosis (2026-11-05, KST)

- Actual source: https://www.pressian.com/pages/articles/2025102210180024463 . Public article extraction returned 1,132 characters and 13 processing units. No synthetic article was used for this diagnosis.
- Browser analysis of that URL ended with HTTP 502 `INVALID_MODEL_OUTPUT` after 531,326 ms. No valid complete analysis was displayed.
- A separate direct measurement of the same real article request received HTTP 200 SSE headers and its first reasoning delta at 167,933 ms. At the 240-second diagnostic deadline it had received approximately 6,000 reasoning characters and zero final-content characters. This diagnostic deadline is separate from the app's 600-second limit.
- A non-generation request to the same API endpoint completed in 0.874 seconds (HTTP 405 for GET), and authenticated model listing returned HTTP 200 with the requested model present. These establish basic connectivity, not inference speed or guaranteed availability.
- The request carries about 8,518 characters of instructions/schema and 1,887 characters of real article input. A reduced schema-guide comparison is diagnostic only; it is not adopted without a successful, validated full analysis.
- NVIDIA's published request schema exposes model, messages, temperature, top_p, max_tokens and stream. The model card's `reasoning_effort=100` benchmark description is not documentation of that parameter on this NVIDIA endpoint. No unsupported reasoning parameter was added.
- The adapter now handles fragmented SSE content, ignores private reasoning, cancels upstream reads, and recognizes `[DONE]` without waiting for the underlying socket to close. It still requires a normal `stop` and valid JSON/schema/evidence before accepting a result.
- Logs contain fixed stage names and durations only (`headers`, `first_delta`, `first_content`, completion/close); no article text, reasoning, keys, or raw provider errors are logged.
- OhmyNews real URL https://www.ohmynews.com/NWS_Web/Mobile/at_pg.aspx?CNTN_CD=A0003000917 returned HTTP 400 when the local Worker omitted User-Agent. An explicit, honest application User-Agent returned HTTP 200. Retrieval now sends it; publisher access restrictions and redirect/host checks remain enforced. A rebuilt local browser request reached NVIDIA and received HTTP headers after 80,612 ms.
- Measured bottlenecks are provider time to first response and reasoning generation. The split between provider queuing/prefill/internal scheduling cannot be inferred from client timing alone. Extending the timeout does not make the model faster.
- Reduced-schema comparison (same real article, original analysis instructions preserved): prompt/schema guide reduced from 8,518 to 4,700 characters. First SSE at 100,336 ms; first final-content delta at 592,822 ms after 19,231 reasoning characters; diagnostic stopped at 600,028 ms with only 836 final-content characters. It did not solve latency and is not used in app code.
- Additional server contract probe: integer `reasoning_effort:1` returned HTTP 400 with a type error requiring a string or map. This shows a server-side field omitted from the public schema; it does not establish the accepted numeric range. A string `low` real-article experiment returned HTTP 200 SSE after 103,300 ms. End-to-end correctness still requires a complete validated result.
- The `low` experiment still had zero final-content characters after 314,710 ms and 11,567 reasoning characters; it was cancelled and is not adopted. These single-run measurements do not establish a stable latency difference.
- The rebuilt OhmyNews browser analysis ended at the configured 600-second deadline with HTTP 504 `TIMEOUT`. Thus the fetch fix is verified, but successful full real-article analysis is still unverified and the provider latency problem is unresolved.
- Final checks: TypeScript passed, 778 tests passed / 13 opt-in tests skipped. Production build is verified separately. Local execution only; no public redeployment.
- `reasoning_effort:"none"` diagnostic received no HTTP headers before Node's HTTP/2 300-second headers timeout (`UND_ERR_HEADERS_TIMEOUT`). Neither support nor a speed improvement was established, and it is not added to the app. This transport timeout occurred in the standalone diagnostic, not the Worker adapter.
