import { useEffect, useMemo, useRef } from 'react'

export const CALL_MUTED = 'hichat-mirror-call-muted'

/**
 * Plays the Meet call's sound: every track of `stream` (one per Meet tab
 * connected), each on its own player, as one player plays only one track.
 * If the browser wants a click first, says so (`onBlocked`), and plays on
 * the next try (`blocked` going false).
 */
export function CallSound({
  stream,
  muted,
  blocked,
  onBlocked,
}: {
  stream: MediaStream
  muted: boolean
  blocked: boolean
  onBlocked: () => void
}) {
  const tracks = useMemo(() => stream.getAudioTracks(), [stream])
  return (
    <>
      {tracks.map((track, i) => (
        <TrackSound
          key={`${i}:${track.id}`}
          track={track}
          muted={muted}
          blocked={blocked}
          onBlocked={onBlocked}
        />
      ))}
    </>
  )
}

function TrackSound({
  track,
  muted,
  blocked,
  onBlocked,
}: {
  track: MediaStreamTrack
  muted: boolean
  blocked: boolean
  onBlocked: () => void
}) {
  const player = useRef<HTMLAudioElement>(null)
  const stream = useMemo(() => new MediaStream([track]), [track])
  useEffect(() => {
    const el = player.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream
    el.muted = muted
    if (!blocked) el.play().catch(() => onBlocked())
    // The lane is set up before any sound: play again when it starts
    const again = () => el.play().catch(() => {})
    track.addEventListener('unmute', again)
    // It can also stop without a word (a speaker change, the laptop
    // waking): start it again while it should be playing
    const watch = setInterval(() => {
      if (!blocked && el.paused) el.play().catch(() => {})
    }, 2000)
    return () => {
      track.removeEventListener('unmute', again)
      clearInterval(watch)
    }
  }, [stream, track, muted, blocked, onBlocked])
  return <audio ref={player} autoPlay hidden />
}
