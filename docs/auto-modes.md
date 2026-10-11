# Auto · Speed and Auto · Accuracy

Choose either mode in the chat's model picker, or set the Auto mode in General
Settings. Both use only Groq and Cerebras, stream incrementally, preserve chat
context and display one winning response. Manual model selection still uses the
chosen provider and the assistant's streaming/reasoning settings.

| Mode | Participants | Reasoning | Selection |
| --- | --- | --- | --- |
| Speed | Groq gpt-oss-20b, Groq gpt-oss-120b, Cerebras gpt-oss-120b start together | Low | First useful answer or actionable tool request wins. |
| Accuracy | Cerebras and Groq 120B start together; Groq 20B starts if both larger attempts fail or time out | Medium | Prefer a useful 120B response; 20B is recovery only. |

Accuracy is the default for browsers that had the previous Auto preference.
A previous manual-model choice stays manual. Old preferred/fallback model settings
no longer determine Auto's providers. Both modes always request streaming, even
if the assistant's manual-model stream setting was off. Only providers with a key
participate; add Groq/Cerebras keys in Model Providers. If neither is configured,
Auto reports that prerequisite rather than silently using another provider.

A reasoning-only, empty, role or usage chunk cannot select a winner. Pre-answer
chunks are buffered per attempt, then the winner's chunks are replayed exactly
once and its subsequent stream is consumed normally. Tool requests count as useful
progress, but only the winning stream reaches tool execution. The unused requests
are aborted. Stop cancels all requests; cancelled or late results cannot become
another chat answer. If a winner fails after its answer starts, normal chat error
handling applies: the app never splices another model's answer into it.

Each attempt gets an eight-second deadline to produce useful progress. Accuracy
can consequently take up to eight seconds to reach its 20B recovery attempt in a
stall; the recovery attempt has its own deadline. This is a failure bound, not an
added wait before healthy responses. Selection follows useful progress immediately.

Image prompts retain the existing Groq/Cerebras vision routing and start at most
one attempt per provider; the GPT-OSS models are not claimed to understand images.
Reasoning settings are passed only where supported by the existing provider/model
adapter. Regular text questions use the three GPT-OSS models listed above.

The actual winning model is retained in response metadata and timing details;
concurrent requests have separate request records so one loser cannot overwrite
the winner's identity. Timings record started, first-chunk, answer/tool-ready,
failed, cancelled and winner events with model/provider names. Readiness timestamps
come from the original stream arrival rather than replaying buffered chunks. Tool
readiness is separate from first answer text. Rendering latency in a hidden browser
window still requires live measurement.

## Tradeoffs and validation

Speed can choose 20B for a difficult question and thus trade answer quality for a
quicker start. Accuracy prefers larger models and more reasoning; it is not an
agreement check or a correctness guarantee. Parallel requests can increase cost
and consume provider rate limits even when losing requests are cancelled. Neither
mode adds a question classifier, response-merging judge or extra answer generation
step before displaying the winner.

Unit and chat integration regressions cover winner selection, reasoning-only
streams, errors, empty streams, tool requests, cancellation, deadlines, missing
participants, preserved winner text and 20B recovery. Compare real questions in
both modes using median/p95 first visible answer time, completion time and accuracy
before claiming a numerical speedup. Provider performance has not been measured
live in this environment.
