# UI response latency audit

Baseline: `ce15533` (latest main, PR #80). Scope: browser rendering and the path from Send to visible text. Provider and answer-quality behavior is preserved.

## Findings and changes

- Removed the frame-by-frame answer reveal. Already-received text now appears directly, including when animation frames are throttled. The existing stream scheduler still flushes the first useful chunk immediately and batches later chunks with a 40 ms timer fallback.
- Code stays readable and copyable during streaming without repeatedly syntax-highlighting the growing block. Finished blocks up to 4,000 characters highlight automatically; larger blocks offer an explicit Highlight code action.
- The composer observes stream identity instead of the full changing answer. Historical messages no longer observe live token speed or stream status unless they are the last message. StreamingContent observes only the current conversation's messages.
- The thread edit callback has stable identity and reads current messages when invoked, allowing memoized historical rows to remain unchanged when another message is added or saved.
- Padding and the scroll button share one scroll controller. The scroll listener no longer gets replaced on every text update.
- Closed metadata dialogs do not serialize and prepare their hidden JSON content.

## Evidence

A production-build Chromium harness used the actual Markdown renderer, text-reveal hook and scroll hook, with controlled input and no provider calls. For a 1,188-character answer arriving in a burst, five alternating runs per mode produced:

- Existing reveal: 12 text commits, median 264 ms until all text was committed (range 229–345 ms).
- Direct text: one text commit, median 35 ms (range 24–133 ms).
- First-word median was 28 ms with reveal and 35 ms without it. This measurement supports faster completion of visible text, not a claim of faster provider response or faster first words.
- The old two-controller sticky-scroll arrangement made 100 scroll calls and replaced listeners 100 times for 50 stream updates. The shared controller has a regression test requiring one scroll and no listener replacement for a subsequent chunk.
- A stalled-animation-frame test received additional text but left only the first 16 characters displayed under the old reveal hook. Removing that second animation layer removes this dependency.
- A 360-line, approximately 12 KB code stress case created about 5,000 DOM nodes. Repeated highlighting during reveal produced long main-thread tasks. This is a stress case, not a typical answer or a MacBook benchmark.

These are local DOM-commit measurements in headless Chromium, not screen-paint or live Railway/provider measurements. The full application was also exercised with a controlled SSE response and saved histories of 0, 100 and 300 messages. Synthetic keys and intercepted requests ensured no real provider calls.

## Areas that do not justify sacrificing functionality

- Menus, icons and the once-per-second Accuracy progress indicator were not identified as response gates.
- The token counter is gated to local llama.cpp; it is not on the normal Groq/Cerebras path.
- Keyboard shortcuts are event-driven, not a polling loop.
- Message persistence is asynchronous and optimistic. Completion history already caps prior messages at 20.

## Remaining limits

- Exa search, model reasoning, provider/network delays and Accuracy verification still contribute real waiting time. The latest code also has a direct Claude Accuracy path when configured. This PR does not weaken correctness checks or change routing.
- Existing first_words telemetry measures receipt of useful text in the stream handler, not browser paint, and begins after some send preparation. End-to-end paint instrumentation remains a separate improvement.
- Very large conversations still mount all rows; windowing is a future option if profiling shows a remaining problem after removing unnecessary rerenders.
- The main bundle and model catalog remain substantial cold-start costs. Further code splitting is separate from warm reply latency.
- Actual Safari/macOS and authenticated production-provider latency were not available in this environment.
