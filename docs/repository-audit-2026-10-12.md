# Repository audit — 12 October 2026

Baseline: `0376fe0` on freshly fetched `origin/main`, including PR #64. Branch: `improve/repo-audit-20261012`.

## Assessment

The app's existing streaming, model racing, Exa grounding, explicit tool approval and platform service interfaces are useful foundations. A rewrite would introduce more risk than the fixes supported by this audit. The main opportunities are reducing initial JavaScript, preventing asynchronous state from overwriting newer user actions, making persistence truthful, and tightening boundaries around credentials, model-generated tool calls and diagnostics.

This review examined the repository layout, web application and shared core, browser storage extension, provider and tool services, Accuracy and Speed pipelines, dictation relay, authentication, rendering, Docker/nginx and CI. The repository contains 883 tracked files at the baseline. This is a repository-wide architectural and source audit with focused fixes and automated validation, not a claim that every line or every optional integration was exhaustively tested. Native macOS/Tauri/mobile behavior, authenticated production model requests, Railway request logs and an OS/container CVE scan were unavailable here.

## Implemented improvements

### Security and privacy

- **Claude endpoint identification:** `anthropicProvider.ts` previously recognized any URL containing `anthropic.com`. A hostname such as `api.anthropic.com.evil.example`, a username component, or a path could therefore be treated as Anthropic. Automatic identification now requires the exact HTTPS origin, an expected root or `/v1` path, and no credentials, query or fragment. Named Claude providers with a nonstandard URL retain the existing official-endpoint fallback. This does not introduce support for arbitrary Claude gateways.
- **Malformed tool arguments:** `completion.ts` previously caught a JSON parse error and continued with `{}`. JSON arrays, scalars and null also reached the tool path. These cases now fail before approval or invocation, including when all tools have been approved. The model receives an `invalid_arguments` result so it can correct the call. Ordinary approved object arguments still use the existing cancellation and permission flow.
- **Security-header inheritance:** every nginx location that sets its own cache headers now includes one shared security-header file. Login, pages, assets, APIs and error responses receive frame denial, MIME sniffing protection, no-referrer policy and a limited CSP covering base URLs, objects, frames and form targets. Obsolete `X-XSS-Protection` was removed. The CSP deliberately does not claim to restrict all scripts or provider connections.
- **Telemetry validation:** an arbitrary `key=value` token previously passed the Accuracy log filter, so text such as `question=private_content` could enter supposedly metadata-only logs. The relay now accepts only known fields, verdicts, model identifiers, bounded counts/times and known failure categories. Unknown fields, duplicate fields and arbitrary values are discarded. The explicit `SPEECH_LOG_TEXT=1` opt-in still enables text diagnostics; historical logs are unaffected.
- **Provider error bodies:** Claude stream failures and Resend HTTP failures no longer copy raw upstream response bodies into application errors/logs. Status codes remain available for diagnosis.
- **Cookie parsing:** a signed cookie must end at the cookie boundary instead of accepting extra characters after its signature. Authentication still requires the valid signature. The tampering regression now always changes a character; previously it had a 1-in-16 chance of leaving the signature unchanged.

### Reliability and data design

- **Streaming after Stop:** `StreamingContent` could hide a new response whenever the last stored assistant response had been stopped. It now suppresses only the matching stopped message, allowing subsequent answers to appear immediately.
- **Pending saves:** an earlier `createMessage` completion could overwrite a newer edit by matching only its ID. It now replaces only the original optimistic object. Clearing chat state while a save is pending no longer recreates that state when the save resolves.
- **Document duplication:** message snapshots no longer copy the assistant's full reference documents on every add/update. The assistant retains its documents and they remain available to prompt construction. This reduces repeated IndexedDB serialization/storage and retained private text; it does not reduce the reference-document tokens sent to a model. Previously stored messages are not silently migrated or deleted.
- **Transaction completion:** browser writes now resolve on IndexedDB transaction commit, not individual request success. A later abort correctly rejects the write. This is not a guarantee against every OS/browser crash or storage eviction.
- **Atomic deletion:** the browser extension removes a thread and its messages in a single transaction, using an indexed cursor instead of loading every message body or building a list of all keys. An aborted transaction leaves both intact. Sidebar deletion remains immediate and does not add a confirmation dialog.
- **Connection lifecycle:** browser storage closes obsolete connections on `versionchange`, allowing another tab to upgrade the database; closed connections are not reused.
- **Model-list state:** an in-flight request is invalidated when the provider is cleared, changed to a cached provider, or the component unmounts. Cached results reset loading/error state and are reused only for the same credential. A changed API key refreshes accessible models. The memory cache has a 50-entry cap and no longer sorts the service's array in place.
- **Claude stream termination:** a disconnected stream no longer synthesizes a successful completion; token-limit termination maps to `length`, and consumer cancellation cancels the response reader. Individual buffered frames have a 1 MiB ceiling. This reduces unfinished answers being treated as complete and prevents unread streams from continuing after a consumer stops.

### Latency and UI

- **Deferred code highlighting:** language grammars and theme definitions load only when a fenced code block is displayed. Code text and Copy remain available while that chunk loads. A failed chunk load falls back to plain code instead of taking down the conversation. Existing language and theme choices remain supported.
- **Deferred emoji picker:** it loads only when opened, with loading/failure text. Its trigger is now a keyboard-accessible button with an accessible name and expanded state.
- **Accuracy progress:** the existing search/draft/check phases now show a compact spinner and elapsed seconds. After ten seconds the UI explains that the request is taking longer and can be stopped. Reduced-motion preferences are respected. There is no fabricated ETA or additional waiting period, and unchecked drafts remain hidden.
- **Static delivery:** nginx enables gzip for eligible text assets. Only fingerprinted assets under `/assets/` receive long-lived immutable caching; public filenames are revalidated so a deployment can update them. Cache directives are private because the site is authenticated. `.mjs` retains the JavaScript MIME type required by PDF workers.
- **Build consistency:** the Docker builder moves from Node 20 to Node 22 to match CI, and its initial install is immutable. The runtime image remains a separate component that needs ongoing patching.

## Measured loading impact

Using the same installed dependency tree and Vite configuration, the baseline and changed production builds produced:

- Main entry JavaScript: **3,855.33 kB → 3,056.33 kB**, a reduction of approximately **20.7%**.
- Main entry gzip estimate: **1,200.82 kB → 949.95 kB**, a reduction of approximately **20.9%**.
- Deferred highlighting chunk: approximately **797.68 kB**, or **250.30 kB gzip**, fetched when needed.

These are build artifact measurements, not measured user download times or production answer-latency claims. Additional final correctness edits can change the last few bytes. Returning to a conversation containing code still loads the highlighting chunk. The main entry and optional model catalog remain large, and Vite's bundle-size warnings remain visible.

## Remaining findings and recommended follow-up

### Accuracy and latency

1. **Search and review remain real costs.** Technical Accuracy requests wait for Exa, a complete draft and a successful review. Personal questions skip search according to the existing classifier. PR #64's concurrent reviewers and Claude preference window are retained. Parallel reviewers increase usage and can hit rate limits; a faster result is not proof of greater correctness.
2. **Evidence matching is not semantic proof.** Exact quotation and claim-span checks reject malformed or unsupported references, but cannot establish that a quotation entails the claim, that every material claim was audited, or that retrieved sources are authoritative and current. Qualified claims and fallback corrections require model judgment. Existing unverified fallback labels remain visible.
3. **Personal-question routing is heuristic.** A mixed personal/technical question can match the personal regex and bypass search. A representative evaluation set is needed before replacing this classifier; adding another model decision to every request would add latency. Include mixed questions, short follow-ups, incorrect API assumptions, library/version ambiguity and source injection in that evaluation set.
4. **Long histories and reference documents increase prefill.** Deduplicating stored snapshots does not reduce model context. The next substantive design step is a provider-aware context budget with pinned instructions/documents, recent exact turns and optional cached summaries. Silent truncation is inappropriate for technical follow-ups and personal background.
5. **Production measurements are still needed.** Track send-to-first-useful-visible-text for Speed, full verified-answer time for Accuracy, and dictation-stop-to-transcript separately. Report p50/p95 alongside correction rate, unsupported-claim rate and cost. Existing search/draft/review metadata supports this, but this environment has no authenticated model or Railway log access. No new provider-speed claims were inferred from unit tests.
6. **Streaming rendering still reparses growing Markdown.** Splitting out highlighting improves cold load. Long streaming code/math answers should be profiled before introducing incremental final-block rendering or message virtualization; those designs must preserve copy, selection, scroll position and accessibility.

### Security and operations

- **Browser-persisted BYOK credentials remain the largest architectural exposure.** Same-origin script execution can access them. A narrowly scoped server gateway with Railway-held keys can reduce this risk, but requires explicit key provisioning, provider/route allowlists, cancellation, rate limits and streaming benchmarks. This audit does not copy browser keys to a server or change where user credentials are stored.
- **Session lifetime remains 365 days**, with no per-device revocation. A dedicated `AUTH_SECRET`, configurable shorter lifetime and a device/session store are worthwhile follow-ups. Changing signing secrets invalidates existing sessions.
- **OTP budgets are global to this single-user deployment.** Anonymous clients can consume resend/attempt budgets. Source-aware limits require correctly configured trusted reverse proxies; trusting arbitrary forwarded addresses would make the protection ineffective.
- **The new CSP is intentionally partial.** Script/connect restrictions need an inventory of configured providers, workers, uploaded images and renderer behavior. `object-src`/framing protections do not substitute for a full XSS policy or removal of browser secrets.
- **nginx remains the authentication boundary.** The relay binds to loopback and must not be published as an independent public service. Origin checks alone do not authenticate non-browser clients.
- **The custom WebSocket implementation still needs maintenance.** Its existing masking, fragmentation, queue and readiness limits are covered by tests. A maintained protocol library and conformance testing should be evaluated independently; replacing it while altering dictation semantics would increase regression risk.
- **API/UI storage failures are not uniformly surfaced.** Several legacy service methods catch read/create errors and return empty/fallback state, and some optimistic thread operations log rather than restore failed writes. The transaction fix makes the browser storage contract truthful but does not redesign every store's retry/rollback UX. A consistent storage-result layer and nonintrusive recovery controls should precede broad error-handling refactors.
- **Image and native security are separate checks.** CI builds the runtime image and exercises auth/proxy behavior; it does not scan its OS packages. Docker base tags still float. The Hammerspoon helper still requires macOS validation for permissions, Secure Input, keyboard layouts and Safari event delivery.

### Dependencies

The fresh registry scan reports **122 vulnerability/advisory records**: **9 critical, 64 high, 42 moderate and 7 low**, plus 14 deprecation records. These counts match the prior audit after its fixes. They are advisory records, not 122 demonstrated production exploits. The `--environment production` workspace scan still includes packages that are build/test tooling within those workspaces; the final nginx/Node image does not contain the entire workspace dependency tree.

The [inventory](security-advisories-2026-10-12.json) records packages, affected versions and advisory URLs. Remaining examples include optional SDK XML/form-data/WebSocket dependencies, Vite/Rollup development tooling, test environments and archive helpers. No dependency upgrades are hidden in this PR. Updating compatible parent SDK/toolchain versions in separately validated changes, adding a reviewed CI advisory baseline and scanning the deployed image are still required. A green test/build result is not a clean vulnerability scan.

### Design and maintainability

- `useChat`, `ChatInput` and `accuracyReview` combine orchestration, state, UI preparation and provider concerns. Keep the tested public behavior while progressively extracting request lifecycle, persistence and evidence-review modules. A wholesale rewrite during a security/performance change would make regressions harder to isolate.
- The service interfaces are useful platform boundaries, but web-only builds still carry legacy provider/platform machinery. Further bundle work should profile the model catalog and TokenJS provider imports before removing capabilities the user may configure.
- Asynchronous state needs one consistent rule: only the still-current request may change visible state. The fixed message-save and model-list cases should guide future hooks.
- Keep accessible controls and honest progress/error states close to the composer. The audit preserves bullet-first answers, no answer tables, explicit Accuracy review labels, immediate sidebar deletion, existing dictation and Option/fn shortcuts. It does not reintroduce Speaker or coding mode.

## Validation

- Focused regressions exercise exact-origin selection, malformed tool calls, pending message edits, document snapshot size, late transaction aborts, atomic deletion, stale model-list requests, stream termination, Stop behavior, logging and rendering.
- Local relay/auth/security suite: **43 passed**.
- Local shared core suite: **151 passed, 5 skipped**.
- Initial full web validation: **1,620 passed, 1 skipped, 1 timed out** in the pre-existing model-list test under concurrent build/test load. That file passed separately; additional stale-response/key-change regressions were added. The final PR CI result is the release check, rather than treating this initial run as green.
- Strict application and browser-extension TypeScript checks passed; the application check was repeated after the final UI fallback adjustment.
- Baseline and changed production Vite builds passed. Existing browser-externalized-module and large-chunk warnings remain.
- Real Chromium checks verified production startup and IndexedDB commit/rollback/deletion behavior. Component browser checks cover deferred code loading, plain-code fallback, readable narrow layouts and no answer tables.
- Docker CI now asserts common headers on pages/assets/API errors, authenticated cache behavior and gzip in addition to the existing login, search and relay smoke tests.

The PR is for review. Merging and deployment require the user's approval, as requested.
