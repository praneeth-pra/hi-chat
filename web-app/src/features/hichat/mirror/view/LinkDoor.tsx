import { useEffect, useState } from 'react'
import type { Gate } from './useMirrorTransport'

/**
 * A mirror link's first page: nothing of the conversation, the shared
 * screen or the camera until the 4-digit code Hi-chat shows is typed. The
 * box starts empty; it says how many tries are left after a wrong code.
 */
export function LinkDoor({
  gate,
  hiChatOn,
  askForCode,
  sendCode,
}: {
  gate: Gate
  /** Whether Hi-chat is open at the other end, to show a code */
  hiChatOn: boolean
  askForCode: () => boolean
  sendCode: (code: string) => boolean
}) {
  const [code, setCode] = useState('')
  // A wrong code clears the box for the next try
  useEffect(() => {
    if (gate.left !== undefined) setCode('')
  }, [gate])
  const runOut = gate.left === 0 && !gate.spent
  const submit = () => {
    if (/^\d{4}$/.test(code) && !gate.spent) sendCode(code)
  }
  return (
    <div className="flex h-full flex-col items-center justify-center bg-main-view px-6 text-main-view-fg">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="flex w-full max-w-xs flex-col gap-3 text-sm"
      >
        <h1 className="text-base font-semibold">Enter the code</h1>
        <label
          htmlFor="mirror-link-code"
          className="leading-relaxed text-main-view-fg/60"
        >
          {gate.asked
            ? 'Type the 4-digit code Hi-chat now shows on the other computer.'
            : 'This mirror link needs a code from Hi-chat. Ask for one, then type the 4 digits Hi-chat shows.'}
        </label>
        {!gate.spent && gate.asked && (
          <div className="flex gap-2">
            <input
              id="mirror-link-code"
              autoFocus
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, '').slice(0, 4))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={4}
              aria-label="Code"
              className="h-10 w-full rounded-md border border-main-view-fg/15 bg-main-view-fg/[0.04] px-2 text-center text-lg tracking-[0.4em] outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            />
            <button
              type="submit"
              disabled={code.length !== 4}
              className="h-10 rounded-md bg-main-view-fg px-4 font-medium text-main-view transition disabled:opacity-40"
            >
              Open
            </button>
          </div>
        )}
        {!gate.spent && (!gate.asked || runOut) && (
          <button
            type="button"
            onClick={askForCode}
            disabled={hiChatOn === false}
            className="h-10 rounded-md border border-main-view-fg/15 font-medium hover:bg-main-view-fg/[0.06] disabled:opacity-40"
          >
            {gate.asked ? 'Get a new code' : 'Get a code'}
          </button>
        )}
        {gate.locked ? (
          <p role="alert" className="text-destructive">
            Too many wrong codes on this link. Copy a new link from Hi-chat.
          </p>
        ) : gate.spent ? (
          <p role="alert" className="text-destructive">
            Too many wrong codes. Reload this page to try again.
          </p>
        ) : runOut ? (
          <p role="alert" className="text-destructive">
            That code has run out. Get a new code.
          </p>
        ) : gate.left !== undefined ? (
          <p role="alert" className="text-destructive">
            Wrong code. {gate.left} {gate.left === 1 ? 'try' : 'tries'} left.
          </p>
        ) : hiChatOn === false ? (
          <p className="text-main-view-fg/50">
            Hi-chat isn't open on the other computer, so it can't show a code.
          </p>
        ) : null}
      </form>
    </div>
  )
}
