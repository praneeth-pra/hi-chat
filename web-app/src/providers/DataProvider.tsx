import { useModelProvider } from '@/hooks/useModelProvider'

import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect } from 'react'
import { useMCPServers, DEFAULT_MCP_SETTINGS } from '@/hooks/useMCPServers'
import { useAssistant } from '@/hooks/useAssistant'
import { useThreads } from '@/hooks/useThreads'
import { AppEvent, events } from '@janhq/core'
import { tidyThreads, useEmptyThreadCleanup } from '@/hooks/useThreadHygiene'
import { deleteOldChats } from '@/lib/chatRetention'

export function DataProvider() {
  const { setProviders } = useModelProvider()

  const { setServers, setSettings } = useMCPServers()
  const { setAssistants, initializeWithLastUsed } = useAssistant()
  const { setThreads } = useThreads()
  const serviceHub = useServiceHub()

  useEffect(() => {
    console.log('Initializing DataProvider...')
    serviceHub.providers().getProviders().then(setProviders)
    serviceHub
      .mcp()
      .getMCPConfig()
      .then((data) => {
        setServers(data.mcpServers ?? {})
        setSettings(data.mcpSettings ?? DEFAULT_MCP_SETTINGS)
      })
    serviceHub
      .assistants()
      .getAssistants()
      .then((data) => {
        // Only update assistants if we have valid data
        if (data && Array.isArray(data) && data.length > 0) {
          setAssistants(data as unknown as Assistant[])
          initializeWithLastUsed()
        }
      })
      .catch((error) => {
        console.warn('Failed to load assistants, keeping default:', error)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceHub])

  useEffect(() => {
    serviceHub
      .threads()
      .fetchThreads()
      .then((threads) => {
        setThreads(threads)
        // Name, count and drop empty chats (reads storage once per chat)
        tidyThreads()
        deleteOldChats()
      })
  }, [serviceHub, setThreads])

  // Settings > General > Delete old chats, checked again every hour
  useEffect(() => {
    const every = setInterval(() => deleteOldChats(), 60 * 60 * 1000)
    return () => clearInterval(every)
  }, [])

  useEmptyThreadCleanup()

  useEffect(() => {
    events.on(AppEvent.onModelImported, () => {
      serviceHub.providers().getProviders().then(setProviders)
    })
  }, [serviceHub, setProviders])

  return null
}
