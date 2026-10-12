import { useThreadScrollState } from './ThreadScrollProvider'

export const ThreadPadding = () => {
  const { paddingHeight } = useThreadScrollState()
  return (
    <div
      style={{ height: paddingHeight }}
      className="flex-shrink-0"
      data-testid="chat-padding"
    />
  )
}
