# Auto · Speed and Auto · Accuracy

Choose a mode in the chat model picker or General Settings. Both use Groq and
Cerebras and preserve chat context. Manual selection still uses the chosen
provider and normal streaming/reasoning settings.

- **Speed:** Groq 20B, Groq 120B and Cerebras 120B start together with Low
  reasoning. The first useful answer or actionable tool request wins, unused
  requests are cancelled, and the winner streams immediately.
- **Accuracy:** the two 120B models race to prepare a Medium-reasoning draft;
  20B is draft recovery. Exa search is mandatory and overlaps drafting. The
  complete draft is held while a 120B reviewer, preferably the other provider,
  checks it against the question, conversation and retrieved sources. Only an
  approved, corrected or uncertainty-qualified answer is shown. Missing evidence
  or failed review produces a clear error; unchecked text never becomes a
  fallback answer. See [Accuracy setup and limitations](accuracy-mode.md).

Configure Groq/Cerebras keys in Model Providers. Accuracy additionally requires
`EXA_API_KEY` in Railway. A previous manual choice remains manual; Auto defaults
to Accuracy. Only configured providers participate. Search uses limited user
question context and never sends assistant answers or attachment payloads to Exa.

A draft attempt has eight seconds to produce useful progress. Reasoning-only,
empty, role and usage chunks cannot win. Tool requests still follow existing MCP
permission checks; the eventual answer is reviewed in Accuracy. Stop cancels
work. Reviewer requests have a 15-second total deadline with bounded recovery.
Search has a 4.5-second server timeout and a 6-second browser deadline. Healthy
responses do not deliberately wait for these failure deadlines.

Image drafting retains the existing vision routing; GPT-OSS models are not
claimed to read images. The text reviewer cannot independently inspect image
pixels, so image-dependent claims need appropriate uncertainty. Normal text
questions use the GPT-OSS participants above.

Response metadata records the drafting model, reviewer/verdict, source links and
review durations. Provider draft-readiness timestamps are distinct from verified
answer visibility. Speed timing still measures first useful streamed text.

Review and useful sources can improve checking but do not establish frontier
quality or guarantee correctness. Groq and Cerebras serve the same underlying
120B model. Parallel requests, mandatory search and review increase API usage.
Accuracy trades some time to first visible answer for checking; Speed provides
immediate streaming. No live provider speedup or accuracy score has been measured
in this workspace. Compare median/p95 latency and correctness on representative
saved questions after deployment.
