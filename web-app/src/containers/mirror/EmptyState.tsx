import { IconMessageCircle } from '@tabler/icons-react'

/** What the conversation shows before it has any messages. */
export function EmptyState({ tone }: { tone: 'off' | 'waiting' | 'live' }) {
  const text =
    tone === 'live'
      ? 'No messages yet. The conversation open in Hi-chat shows here as it happens.'
      : tone === 'off'
        ? 'Open Hi-chat on your other computer, and its open conversation shows here live.'
        : 'Connecting to Hi-chat…'
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-main-view-fg/10 bg-main-view-fg/[0.03] text-main-view-fg/50">
        <IconMessageCircle size={22} stroke={1.5} />
      </div>
      <p className="max-w-sm text-sm leading-relaxed text-main-view-fg/55">
        {text}
      </p>
    </div>
  )
}
