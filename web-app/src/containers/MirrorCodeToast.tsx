import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { IconDeviceLaptop, IconX } from '@tabler/icons-react'

// The code a mirror link's viewer types to get in (lib/mirrorGate.ts), shown
// in Hi-chat's own colours: the code large, how long it has left, and a
// close button. It goes when the viewer is let in, leaves, or the code runs
// out, or when it's closed here.

const ID = 'mirror-link-code'

/** Shows `code` until `expiresAt` (ms); `null` hides it. */
export function showMirrorCode(code: string | null, expiresAt?: number) {
  if (!code) {
    toast.dismiss(ID)
    return
  }
  const until = expiresAt ?? Date.now() + 5 * 60_000
  toast.custom(
    () => (
      <MirrorCodeToast
        code={code}
        expiresAt={until}
        onClose={() => toast.dismiss(ID)}
      />
    ),
    {
      id: ID,
      duration: Math.max(1000, until - Date.now()),
      // The card draws itself; not the app's default toast look
      style: { background: 'transparent', padding: 0, border: 0 },
    }
  )
}

/** "4:05" */
function left(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function MirrorCodeToast({
  code,
  expiresAt,
  onClose,
  now = Date.now,
}: {
  code: string
  expiresAt: number
  onClose: () => void
  now?: () => number
}) {
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <div
      role="status"
      aria-label="Mirror link code"
      data-testid="mirror-code-toast"
      className="w-[300px] select-none rounded-xl border border-main-view-fg/10 bg-main-view p-3.5 text-main-view-fg shadow-lg"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-main-view-fg/[0.06] text-main-view-fg/70">
          <IconDeviceLaptop size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-main-view-fg/60">
            Code for your mirror link
          </p>
          <p
            className="mt-0.5 font-mono text-2xl font-semibold tabular-nums tracking-[0.3em]"
            aria-label={`Code ${code.split('').join(' ')}`}
          >
            {code}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide the code"
          title="Hide the code"
          className="-mr-1 -mt-1 rounded-md p-1 text-main-view-fg/45 transition-colors outline-none hover:bg-main-view-fg/[0.06] hover:text-main-view-fg focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <IconX size={16} />
        </button>
      </div>
      <p className="mt-2.5 text-xs leading-snug text-main-view-fg/60">
        Type it only on your own laptop. Whoever has it sees this chat and the
        shared screen.
      </p>
      <p className="mt-1.5 text-[11px] tabular-nums text-main-view-fg/45">
        Expires in {left(expiresAt - now())}
      </p>
    </div>
  )
}
