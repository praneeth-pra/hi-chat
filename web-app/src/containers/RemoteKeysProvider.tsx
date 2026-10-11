import { useEffect } from 'react'
import { listenForRemoteKeys } from '@/lib/remoteKeys'
import { isPlatformTauri } from '@/lib/platform/utils'

/** Keyboard helpers work independently of microphone capture. */
export function RemoteKeysProvider() {
  useEffect(() => (isPlatformTauri() ? undefined : listenForRemoteKeys()), [])
  return null
}
