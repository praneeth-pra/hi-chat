import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { MirrorViewer } from '@/containers/MirrorView'

// The remote mirror, signed in: follows the conversation open in Hi-chat
// (see containers/MirrorView.tsx). Each app's own link is /m/<link>.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.mirror as any)({
  component: () => <MirrorViewer />,
})
