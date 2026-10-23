import { IconMicrophone, IconMicrophoneOff } from '@tabler/icons-react'
import { useDictationEnabled } from '@/hooks/useDictationEnabled'
import { cancelDictation, letGoOfMic } from '@/lib/dictation'
import { cn } from '@/lib/utils'

// In the chat header: dictation on or off on this device.

export function DictationToggleButton() {
  const on = useDictationEnabled((s) => s.on)
  const setOn = useDictationEnabled((s) => s.setOn)
  const label = on
    ? 'Dictation on. Click to turn it off on this device.'
    : 'Dictation off on this device. Click to turn it on.'
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={() => {
        if (on) {
          cancelDictation()
          letGoOfMic()
        }
        setOn(!on)
      }}
      className={cn(
        'size-8 flex items-center justify-center rounded hover:bg-main-view-fg/10 hover:text-main-view-fg cursor-pointer',
        !on && 'text-red-500/70 hover:text-red-500'
      )}
    >
      {on ? (
        <IconMicrophone size={18} stroke={1.5} />
      ) : (
        <IconMicrophoneOff size={18} stroke={1.5} />
      )}
    </button>
  )
}
