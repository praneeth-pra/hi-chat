import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { MirrorViewer } from '@/containers/MirrorView'
import { linkFromLocation } from '@/lib/mirrorLink'

// An app's own mirror link, /m#<secret>, opened without login: the
// conversation open in that copy of Hi-chat (see lib/mirrorLink.ts). The
// secret is in the fragment, so it never reaches the server or its logs.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute('/m' as any)({
  component: LinkMirror,
})

function LinkMirror() {
  const [link, setLink] = useState(() => linkFromLocation(window.location))
  useEffect(() => {
    const read = () => setLink(linkFromLocation(window.location))
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  if (!link)
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-main-view-fg/60">
        This mirror link is incomplete. Copy it again from Hi-chat's link
        button.
      </div>
    )
  return <MirrorViewer key={link} link={link} />
}
