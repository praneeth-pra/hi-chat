import { useState } from 'react'
import { IconCheck, IconCopy, IconLink, IconRefresh } from '@tabler/icons-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { copyText, mirrorLinkUrl, renewMirrorLink } from '@/lib/mirrorLink'
import { cn } from '@/lib/utils'

// This app's mirror link, in the chat header: copy it to follow this app's
// conversation elsewhere without logging in, or replace it (the old one
// stops working at once).

export function MirrorLinkButton() {
  const [url, setUrl] = useState(() => mirrorLinkUrl(window.location))
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const copy = async () => {
    if (await copyText(url)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) copy()
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
            computer. No login needed, so share it only with yourself.
          </p>
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
              <span>The current link will stop working.</span>
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
                  onClick={async () => {
                    const next = mirrorLinkUrl(
                      window.location,
                      renewMirrorLink()
                    )
                    setUrl(next)
                    setConfirming(false)
                    if (await copyText(next)) {
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    }
                  }}
                  className="rounded bg-destructive px-2 py-1 font-medium text-destructive-fg hover:bg-destructive/90"
                >
                  New link
                </button>
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-1.5 self-start text-xs text-main-view-fg/60 hover:text-main-view-fg"
            >
              <IconRefresh size={14} /> New link
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
