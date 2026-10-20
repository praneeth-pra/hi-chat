import { createFileRoute, redirect } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { CAMERA_PANEL, store } from '@/hooks/useCameraSender'

// The remote camera now lives in /mirror's camera panel; /camera opens it, so
// saved links and laptops that start the camera by themselves keep working.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.camera as any)({
  beforeLoad: () => {
    store(CAMERA_PANEL, '1')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throw redirect({ to: route.mirror as any, replace: true })
  },
})
