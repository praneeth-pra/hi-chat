/**
 * Architecture answers drawn as ASCII boxes broke apart in a narrow chat
 * window (13 Oct: side-by-side boxes wrapped into a jumble). Answers now use
 * two block types that stay readable at any width:
 * - ```flow: one component per line, top to bottom, drawn as stacked cards
 *   joined by arrows. "Name: what it does" bolds the name.
 * - ```tree: a folder layout, kept unwrapped so its indentation lines up.
 */

export const DIAGRAM_LANGUAGES = ['flow', 'tree'] as const

export function isDiagramLanguage(language: string): boolean {
  return (DIAGRAM_LANGUAGES as readonly string[]).includes(language)
}

/** The flow's steps: one per non-empty line, list markers and arrows dropped. */
export function flowSteps(code: string): { name: string; note: string }[] {
  return code
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*(?:[-*•]|\d+[.)]|->|→|↓)\s+/, '')
        .replace(/^\s*(?:->|→|↓)\s*$/, '')
        .trim()
    )
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(':')
      return i > 0 && i < 40
        ? { name: line.slice(0, i).trim(), note: line.slice(i + 1).trim() }
        : { name: line, note: '' }
    })
}

export function FlowDiagram({ code }: { code: string }) {
  const steps = flowSteps(code)
  return (
    <div data-flow-diagram className="flex flex-col items-stretch my-2">
      {steps.map((step, i) => (
        <div key={i} className="flex flex-col items-center">
          {i > 0 && (
            <span aria-hidden className="text-main-view-fg/40 leading-none py-1">
              ↓
            </span>
          )}
          <div className="w-full rounded-lg border border-main-view-fg/[0.12] bg-main-view-fg/[0.03] px-3 py-2 text-sm">
            <span className="font-semibold">{step.name}</span>
            {step.note && (
              <span className="text-main-view-fg/70">: {step.note}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export function TreeLayout({ code }: { code: string }) {
  return (
    <pre
      data-tree-layout
      className="my-2 rounded-lg border border-main-view-fg/[0.12] bg-main-view-fg/[0.03] px-3 py-2 text-[13px] leading-snug overflow-x-auto whitespace-pre"
    >
      <code>{code}</code>
    </pre>
  )
}
