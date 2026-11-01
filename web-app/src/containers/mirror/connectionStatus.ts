import type { ScreenStats } from '@/lib/remoteCamera'

// How well the mirror is connected: the status pill's text and tone, and
// the shared screen's delay, explained.

/**
 * The mirror's status pill. Live, with the round trip: straight to Hi-chat
 * when a direct channel is open ("Direct"), else to the server; amber when
 * it's slow.
 */
export function mirrorStatus({
  connected,
  senderOn,
  lag,
  direct,
}: {
  connected: boolean
  /** Whether Hi-chat is open at the other end */
  senderOn: boolean
  /** The round trip in ms, if known */
  lag: number | null
  direct: boolean
}) {
  const via = direct ? 'Direct' : 'Live'
  return !connected
    ? { label: 'Reconnecting…', tone: 'waiting' as const }
    : !senderOn
      ? { label: "Hi-chat isn't open", tone: 'off' as const }
      : lag === null
        ? { label: via, tone: 'live' as const }
        : {
            label: `${via} · ${lag} ms`,
            tone: lag > 400 ? ('waiting' as const) : ('live' as const),
          }
}

/** The readout's breakdown, on hover. */
export function screenStatsTitle(s: ScreenStats) {
  return [
    `About ${s.estimateMs ?? '?'} ms from a change there to here:`,
    `network ${s.rttMs === null ? '?' : Math.round(s.rttMs / 2)} ms (half of a ${s.rttMs ?? '?'} ms round trip),`,
    `waiting for the next frame ${s.fps ? Math.round(500 / s.fps) : '?'} ms (${s.fps} fps),`,
    `buffer ${s.bufferMs} ms, decode ${s.decodeMs} ms.`,
    s.relay
      ? 'Through a relay server: a direct connection would be quicker.'
      : 'Direct between the two computers.',
  ].join(' ')
}
