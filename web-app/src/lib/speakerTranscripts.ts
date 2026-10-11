export type TranscriptResult = {
  texts: string[]
  timings: { name: string; ms: number; ok: boolean }[]
}

export const LIVE_FALLBACK_MS = 1500
export const LIVE_COLLECTION_MS = 300

/** A slow primary cannot hold up a usable side engine. Keep original engine order. */
export function collectSpeakerTranscripts(
  jobs: Promise<TranscriptResult | null>[],
  upload: () => Promise<TranscriptResult>,
  trace: (stage: string) => void = () => {}
): Promise<TranscriptResult> {
  return new Promise((resolve, reject) => {
    const heard = new Map<number, TranscriptResult>()
    let remaining = jobs.length
    let finished = false
    let fallbackStarted = false
    let fallbackError: unknown
    let collection: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      finished = true
      clearTimeout(collection)
      clearTimeout(fallback)
    }
    const finish = () => {
      if (finished || !heard.size) return
      const results = [...heard]
        .sort(([a], [b]) => a - b)
        .map(([, result]) => result)
      cleanup()
      resolve({
        texts: results.flatMap((r) => r.texts),
        timings: results.flatMap((r) => r.timings),
      })
    }
    const fallbackUpload = () => {
      if (finished || fallbackStarted) return
      fallbackStarted = true
      remaining++
      trace('fallback-start')
      listen(jobs.length, Promise.resolve().then(upload))
    }
    const listen = (index: number, job: Promise<TranscriptResult | null>) => {
      job
        .then((result) => {
          if (finished || !result) return
          const valid = result.timings
            .filter((t) => t.ok)
            .map((t, i) => ({ timing: t, text: result.texts[i] }))
            .filter((r) => r.text?.trim())
          if (!valid.length) return
          heard.set(index, {
            texts: valid.map((r) => r.text),
            timings: valid.map((r) => r.timing),
          })
          trace('engine-ready')
          if (!collection) collection = setTimeout(finish, LIVE_COLLECTION_MS)
        })
        .catch((error) => {
          if (index === jobs.length) fallbackError = error
        })
        .finally(() => {
          remaining--
          if (finished || remaining) return
          if (heard.size) finish()
          else if (!fallbackStarted) fallbackUpload()
          else {
            cleanup()
            if (fallbackError) reject(fallbackError)
            else resolve({ texts: [], timings: [] })
          }
        })
    }
    const fallback = setTimeout(fallbackUpload, LIVE_FALLBACK_MS)
    jobs.forEach((job, index) => listen(index, job))
    if (!jobs.length) fallbackUpload()
  })
}
