import {
  createContext,
  useContext,
  type ReactNode,
  type RefObject,
} from 'react'
import { useThreadScrolling } from '@/hooks/useThreadScrolling'

const ThreadScrollContext = createContext<ReturnType<
  typeof useThreadScrolling
> | null>(null)

/** One scroll controller per conversation; streaming does not rerender its children. */
export function ThreadScrollProvider({
  threadId,
  scrollContainerRef,
  children,
}: {
  threadId: string
  scrollContainerRef: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  const state = useThreadScrolling(threadId, scrollContainerRef)
  return (
    <ThreadScrollContext.Provider value={state}>
      {children}
    </ThreadScrollContext.Provider>
  )
}

export function useThreadScrollState() {
  const state = useContext(ThreadScrollContext)
  if (!state)
    throw new Error('Thread scroll controls require ThreadScrollProvider')
  return state
}
