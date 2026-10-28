import { useEffect, useState } from 'react'
import { IconCheck, IconCopy, IconLink, IconLinkOff } from '@tabler/icons-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  copyText,
  endsIn,
  mirrorLinkExpiresAt,
  mirrorLinkUrl,
  renewMirrorLink,
  shareMirrorLink,
} from '@/lib/mirrorLink'
import { cn } from '@/lib/utils'

// This app's mirror link, in the chat header: copy it to follow this app's
// conversation elsewhere without logging in. It works for 90 minutes, and
// "Revoke link" ends it sooner (anyone on it is cut off at once).

export function MirrorLinkButton() {
  // The link shown, or null once it ended: revoked, or out of time
  const [url, setUrl] = useState<string | null>(null)
  const [ended, setEnded] = useState<'revoked' | 'expired' | null>(null)
  const [left, setLeft] = useState(0)
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [open, setOpen] = useState(false)

  const copy = async () => {
    const next = mirrorLinkUrl(window.location, shareMirrorLink())
    setUrl(next)
    setEnded(null)
    setLeft(mirrorLinkExpiresAt() - Date.now())
    if (await copyText(next)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  // Counts down while open, and says so when the link runs out
  useEffect(() => {
    if (!open || !url) return
    const timer = setInterval(() => {
      // Reading the link makes a new one once this has run out
      if (mirrorLinkUrl(window.location) === url)
        return setLeft(mirrorLinkExpiresAt() - Date.now())
      setUrl(null)
      setEnded('expired')
      setConfirming(false)
    }, 5_000)
    return () => clearInterval(timer)
  }, [open, url])

  const revoke = () => {
    renewMirrorLink()
    setUrl(null)
    setEnded('revoked')
    setConfirming(false)
  }

  return (
    <Popover
      onOpenChange={(o) => {
        setOpen(o)
        if (o) copy()
        else setConfirming(false)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Copy this app's mirror link"
          aria-label="Copy this app's mirror link"
          className="size-8 flex items-center justify-center rounded hover:bg-main-view-fg/10 hover:text-main-view-fg cursor-pointer"
        >
          <IconLink size={18} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="flex flex-col gap-2.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">Mirror link</span>
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs text-main-view-fg/50 transition-opacity',
                copied ? 'opacity-100' : 'opacity-0'
              )}
            >
              <IconCheck size={14} /> Copied
            </span>
          </div>
          <p className="text-xs leading-relaxed text-main-view-fg/60">
            Opens this app's conversation live, with the remote camera, on any
            computer. No login needed, so share it only with yourself. It stops
            working 90 minutes after you copy it.
          </p>
          {url ? (
            <>
              <div className="flex gap-1.5">
                <input
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Mirror link"
                  className="h-8 min-w-0 flex-1 rounded-md border border-main-view-fg/10 bg-main-view-fg/[0.03] px-2 font-mono text-xs text-main-view-fg/80 outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                />
                <button
                  type="button"
                  onClick={copy}
                  title="Copy"
                  aria-label="Copy the mirror link"
                  className="flex size-8 shrink-0 items-center justify-center rounded-md border border-main-view-fg/10 hover:bg-main-view-fg/[0.06]"
                >
                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </button>
              </div>
              {confirming ? (
                <div className="flex items-center justify-between gap-2 rounded-md bg-main-view-fg/[0.04] px-2.5 py-2 text-xs">
                  <span>Anyone using this link is cut off now.</span>
                  <span className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      className="rounded px-2 py-1 hover:bg-main-view-fg/[0.08]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={revoke}
                      className="rounded bg-destructive px-2 py-1 font-medium text-destructive-fg hover:bg-destructive/90"
                    >
                      Revoke
                    </button>
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-main-view-fg/50">{endsIn(left)}</span>
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className="inline-flex items-center gap-1.5 text-main-view-fg/60 hover:text-destructive"
                  >
                    <IconLinkOff size={14} /> Revoke link
                  </button>
                </div>
              )}
            </>
          ) : ended ? (
            <div className="flex items-center justify-between gap-2 rounded-md bg-main-view-fg/[0.04] px-2.5 py-2 text-xs">
              <span role="status">
                {ended === 'revoked'
                  ? 'Link revoked. Anyone using it was cut off.'
                  : 'This link has ended. Its 90 minutes are up.'}
              </span>
              <button
                type="button"
                onClick={copy}
                className="shrink-0 rounded px-2 py-1 font-medium hover:bg-main-view-fg/[0.08]"
              >
                Copy a new link
              </button>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
