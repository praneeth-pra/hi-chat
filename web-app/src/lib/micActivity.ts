/** Dictation uses physical microphones, excluding loopback inputs. */
const LOOPBACK_DEVICE_PATTERN = /blackhole/i
/** Read only: retain the microphone choice saved before dictation had its own setting. */
const LEGACY_MIC_DEVICE_STORAGE_KEY = 'speaker-mic-device'

export const DICTATION_MIC_STORAGE_KEY = 'dictation-mic-device'

export function getDictationMic(): string {
  try {
    return (
      localStorage.getItem(DICTATION_MIC_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_MIC_DEVICE_STORAGE_KEY) ??
      ''
    )
  } catch {
    return ''
  }
}

export function setDictationMic(label: string) {
  try {
    localStorage.setItem(DICTATION_MIC_STORAGE_KEY, label)
  } catch {
    // Storage blocked: the default input stays in use
  }
}

/** The microphones you can pick (never the loopback), by name. */
export async function listMics(): Promise<string[]> {
  const media = navigator.mediaDevices
  if (!media?.enumerateDevices) return []
  let devices = await media.enumerateDevices()
  if (!devices.some((d) => d.kind === 'audioinput' && d.label)) {
    // Names stay hidden until audio permission is granted: ask once
    const probe = await media.getUserMedia({ audio: true })
    probe.getTracks().forEach((t) => t.stop())
    devices = await media.enumerateDevices()
  }
  const names = devices
    .filter(
      (d) =>
        d.kind === 'audioinput' &&
        d.label &&
        d.deviceId !== 'default' &&
        d.deviceId !== 'communications' &&
        !LOOPBACK_DEVICE_PATTERN.test(d.label)
    )
    .map((d) => d.label)
  return [...new Set(names)]
}

export function findMicDevice<
  T extends Pick<MediaDeviceInfo, 'kind' | 'label' | 'deviceId'>,
>(devices: T[], preferred = ''): T | undefined {
  const inputs = devices.filter(
    (d) => d.kind === 'audioinput' && !LOOPBACK_DEVICE_PATTERN.test(d.label)
  )
  return (
    (preferred ? inputs.find((d) => d.label === preferred) : undefined) ??
    inputs.find((d) => d.deviceId === 'default') ??
    inputs.find((d) => d.deviceId !== 'communications') ??
    inputs[0]
  )
}
