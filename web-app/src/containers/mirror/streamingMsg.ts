import type { MirrorMessage as MirrorMessageData } from '@/lib/remoteMirror'

/** The streamed reply's message object, kept while its text is the same. */
const streamMsgs = new WeakMap<object, MirrorMessageData>()
export function streamingMsg(s: {
  id: string
  text: string
}): MirrorMessageData {
  let m = streamMsgs.get(s)
  if (!m) {
    m = { id: s.id, role: 'assistant', text: s.text }
    streamMsgs.set(s, m)
  }
  return m
}
