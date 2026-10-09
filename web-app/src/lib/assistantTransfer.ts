/**
 * Export and import of assistants as a JSON file, so each candidate's setup
 * (instructions, documents, key terms) can be backed up or moved to another
 * browser.
 */

type Named = { id: string; name: string }

export const exportFileName = (date = new Date()) =>
  `assistants-${date.toISOString().slice(0, 10)}.json`

export const exportAssistants = <T extends Named>(assistants: T[]) =>
  JSON.stringify(assistants, null, 2)

/** Assistants from an exported file; entries without an id or name are left out. */
export function parseAssistants<T extends Named>(text: string): T[] {
  const parsed = JSON.parse(text)
  const list = Array.isArray(parsed) ? parsed : [parsed]
  return list.filter(
    (a): a is T =>
      !!a &&
      typeof a === 'object' &&
      typeof a.id === 'string' &&
      !!a.id &&
      typeof a.name === 'string'
  )
}

/** Adds new assistants and replaces ones with the same id. */
export function importAssistants<T extends Named>(
  incoming: T[],
  existing: Named[],
  add: (a: T) => void,
  update: (a: T) => void
) {
  let added = 0
  let updated = 0
  for (const a of incoming) {
    if (existing.some((e) => e.id === a.id)) {
      update(a)
      updated++
    } else {
      add(a)
      added++
    }
  }
  return { added, updated }
}

export function downloadAssistants<T extends Named>(assistants: T[]) {
  const blob = new Blob([exportAssistants(assistants)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = exportFileName()
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
