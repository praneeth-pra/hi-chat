import { useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import { listenForRemoteKeys } from '@/lib/remoteKeys'
import { isPlatformTauri } from '@/lib/platform/utils'
import { route } from '@/constants/routes'

/** Keyboard helpers work independently of microphone capture. */
export function RemoteKeysProvider() {
  const router = useRouter()
  useEffect(
    () =>
      isPlatformTauri()
        ? undefined
        : listenForRemoteKeys(() => router.navigate({ to: route.home })),
    [router]
  )
  return null
}
