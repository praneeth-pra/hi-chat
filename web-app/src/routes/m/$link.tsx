import { createFileRoute } from '@tanstack/react-router'
import { MirrorViewer } from '@/containers/MirrorView'

// An app's own mirror link, opened without login: the conversation open in
// that copy of Hi-chat, with the camera panel (see lib/mirrorLink.ts)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute('/m/$link' as any)({
  component: LinkMirror,
})

function LinkMirror() {
  const { link } = Route.useParams() as { link: string }
  return <MirrorViewer key={link} link={link} />
}
