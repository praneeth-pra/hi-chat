import { getSmartTurn, setSmartTurn } from '@/lib/smartTurn'
import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { anthropicConfig } from '@/lib/anthropicProvider'
import { useAppUpdater } from '@/hooks/useAppUpdater'
import { useEffect, useState, useCallback } from 'react'
import ChangeDataFolderLocation from '@/containers/dialogs/ChangeDataFolderLocation'
import { FactoryResetDialog } from '@/containers/dialogs'
import { useServiceHub } from '@/hooks/useServiceHub'
import {
  IconFolder,
  IconLogs,
  IconCopy,
  IconCopyCheck,
} from '@tabler/icons-react'
// import { windowKey } from '@/constants/windows'
import { toast } from 'sonner'
import { isDev } from '@/lib/utils'
import { SystemEvent } from '@/types/events'
import { Input } from '@/components/ui/input'
import { useHardware } from '@/hooks/useHardware'
import LanguageSwitcher from '@/containers/LanguageSwitcher'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import { isRootDir } from '@/utils/path'
import { getLiveMode, setLiveMode } from '@/lib/speakerLive'
import {
  DICTATION_ENGINES,
  getDictationEngine,
  getKeepMicReady,
  setDictationEngine,
  setKeepMicReady,
  switchMic,
} from '@/lib/dictation'
import { Textarea } from '@/components/ui/textarea'
import {
  availableJudges,
  compareJudges,
  formatBench,
  type BenchResult,
} from '@/lib/judgeBench'
import {
  activeKeyTerms,
  dictionaryTerms,
  getDictionary,
  setDictionary,
} from '@/lib/keyTerms'
import {
  formatReplay,
  formatTypes,
  loadLabeledClips,
  replayLabeled,
  replaySummary,
  type ReplayResult,
} from '@/lib/replayBench'
import {
  getJudgeModel,
  getWaitMode,
  getClipTypes,
  setClipTypes,
  getSecondJudge,
  setSecondJudge,
  JUDGE_MODELS,
  setJudgeModel,
  setWaitMode,
  type JudgeModel,
} from '@/lib/speakerFilter'
import {
  getMicDevice,
  getMicTurns,
  listMics,
  setMicDevice,
  setMicTurns,
} from '@/lib/micActivity'
import { getTablesAsLists, setTablesAsLists } from '@/lib/tablesToLists'
import {
  ANSWER_MODELS,
  ANSWER_QUESTIONS,
  answerSummary,
  availableAnswerModels,
  compareAnswers,
  formatAnswers,
  type AnswerResult,
} from '@/lib/answerBench'
import { useAssistant } from '@/hooks/useAssistant'
import { renderInstructions } from '@/lib/instructionTemplate'
import { withDocuments } from '@/lib/assistantDocuments'
import {
  CHAT_THINKING_LEVELS,
  type ChatThinking,
  getChatThinking,
  setChatThinking,
} from '@/lib/chatThinking'
import {
  CHAT_MODELS,
  type ChatModelKey,
  getChatFallback,
  getChatModel,
  setChatFallback,
  setChatModel,
  useChatAuto,
} from '@/lib/chatModels'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  getTranscribeMode,
  reportClip,
  setTranscribeMode,
  TRANSCRIBE_MODES,
  type TranscribeMode,
} from '@/lib/speakerCaptureSession'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.general as any)({
  component: General,
})

function General() {
  const { t } = useTranslation()
  const {
    spellCheckChatInput,
    setSpellCheckChatInput,
    huggingfaceToken,
    setHuggingfaceToken,
  } = useGeneralSetting()
  const serviceHub = useServiceHub()

  const openFileTitle = (): string => {
    if (IS_MACOS) {
      return t('settings:general.showInFinder')
    } else if (IS_WINDOWS) {
      return t('settings:general.showInFileExplorer')
    } else {
      return t('settings:general.openContainingFolder')
    }
  }
  const { checkForUpdate } = useAppUpdater()
  const { pausePolling } = useHardware()
  const [janDataFolder, setJanDataFolder] = useState<string | undefined>()
  const [isCopied, setIsCopied] = useState(false)
  const [selectedNewPath, setSelectedNewPath] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [transcribeMode, setTranscribeModeState] =
    useState<TranscribeMode>(getTranscribeMode)
  const [liveMode, setLiveModeState] = useState(getLiveMode)
  const [dictationEngine, setDictationEngineState] =
    useState(getDictationEngine)
  const [keepMic, setKeepMicState] = useState(getKeepMicReady)
  const [judgeModel, setJudgeModelState] = useState<JudgeModel>(getJudgeModel)
  const [secondJudge, setSecondJudgeState] = useState<JudgeModel | undefined>(
    getSecondJudge
  )
  const [bench, setBench] = useState<BenchResult[] | null>(null)
  const [benchRunning, setBenchRunning] = useState(false)
  const runBench = async () => {
    const providers = useModelProvider.getState()
    const groq = providers.getProviderByName('groq')
    const cerebras = providers.getProviderByName('cerebras')
    const config = {
      apiKey: groq?.api_key,
      baseUrl: groq?.base_url,
      cerebras: { apiKey: cerebras?.api_key, baseUrl: cerebras?.base_url },
      anthropic: anthropicConfig(providers.providers),
    }
    const judges = availableJudges(config)
    if (!judges.length) {
      toast.error('Add a Cerebras, Groq or Anthropic key first')
      return
    }
    setBenchRunning(true)
    setBench([])
    try {
      await compareJudges(config, judges, (r) =>
        setBench((done) => [...(done ?? []), r])
      )
    } finally {
      setBenchRunning(false)
    }
  }
  const [replay, setReplay] = useState<ReplayResult | null>(null)
  const [replayProgress, setReplayProgress] = useState<string | null>(null)
  const runReplay = async () => {
    const providers = useModelProvider.getState()
    const groq = providers.getProviderByName('groq')
    const cerebras = providers.getProviderByName('cerebras')
    // The settings a live interview would use right now
    const config = {
      apiKey: groq?.api_key,
      baseUrl: groq?.base_url,
      cerebras: { apiKey: cerebras?.api_key, baseUrl: cerebras?.base_url },
      anthropic: anthropicConfig(providers.providers),
      judge: getJudgeModel(),
      secondJudge: getSecondJudge(),
      keyterms: activeKeyTerms(
        useAssistant.getState().currentAssistant?.keyterms
      ),
    }
    if (!availableJudges(config).length) {
      toast.error('Add a Cerebras, Groq or Anthropic key first')
      return
    }
    setReplay(null)
    setReplayProgress('Loading...')
    try {
      const clips = await loadLabeledClips()
      const result = await replayLabeled(
        clips,
        config,
        getWaitMode(),
        (done, total) => setReplayProgress(`${done}/${total}`)
      )
      setReplay(result)
      // Kept in the server log, so runs can be compared over time
      reportClip(replaySummary(result))
    } catch (err) {
      toast.error(`Replay failed: ${(err as Error).message}`)
    } finally {
      setReplayProgress(null)
    }
  }
  const [answers, setAnswers] = useState<AnswerResult[] | null>(null)
  const [answersRunning, setAnswersRunning] = useState(false)
  const runAnswers = async () => {
    const providers = useModelProvider.getState()
    const cerebras = providers.getProviderByName('cerebras')
    const assistant = useAssistant.getState().currentAssistant
    const config = {
      anthropic: anthropicConfig(providers.providers),
      cerebras: { apiKey: cerebras?.api_key, baseUrl: cerebras?.base_url },
      // The same instructions and documents a live answer gets
      instructions: assistant
        ? withDocuments(
            renderInstructions(assistant.instructions),
            assistant.documents
          )
        : undefined,
    }
    const models = availableAnswerModels(config)
    if (!models.length) {
      toast.error('Add an Anthropic or Cerebras key first')
      return
    }
    setAnswersRunning(true)
    setAnswers([])
    try {
      await compareAnswers(config, models, (r) =>
        setAnswers((done) => [...(done ?? []), r])
      )
    } finally {
      setAnswersRunning(false)
    }
  }
  const [chatModel, setChatModelState] = useState<ChatModelKey>(getChatModel)
  const [chatFallback, setChatFallbackState] =
    useState<ChatModelKey>(getChatFallback)
  const [chatThinking, setChatThinkingState] =
    useState<ChatThinking>(getChatThinking)
  const [waitMode, setWaitModeState] = useState(getWaitMode)
  const [clipTypes, setClipTypesState] = useState(getClipTypes)
  const [smartTurn, setSmartTurnState] = useState(getSmartTurn)
  const [micTurns, setMicTurnsState] = useState(getMicTurns)
  const [micDevice, setMicDeviceState] = useState(getMicDevice)
  const [mics, setMics] = useState<string[] | null>(null)
  const loadMics = (open: boolean) => {
    if (!open) return
    listMics()
      .then(setMics)
      .catch(() => {
        setMics([])
        toast.error('Allow microphone access to list your mics')
      })
  }
  const [tablesAsLists, setTablesAsListsState] = useState(getTablesAsLists)
  const [dictionary, setDictionaryState] = useState(getDictionary)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)

  useEffect(() => {
    const fetchDataFolder = async () => {
      const path = await serviceHub.app().getJanDataFolder()
      setJanDataFolder(path)
    }

    fetchDataFolder()
  }, [serviceHub])

  const resetApp = async () => {
    // Prevent resetting if data folder is root directory
    if (isRootDir(janDataFolder ?? '/')) {
      toast.error(t('settings:general.couldNotResetRootDirectory'))
      return
    }
    pausePolling()
    // TODO: Loading indicator
    await serviceHub.app().factoryReset()
  }

  const handleOpenLogs = async () => {
    try {
      await serviceHub.window().openLogsWindow()
    } catch (error) {
      console.error('Failed to open logs window:', error)
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000) // Reset after 2 seconds
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
  }

  const handleDataFolderChange = async () => {
    const selectedPath = await serviceHub.dialog().open({
      multiple: false,
      directory: true,
      defaultPath: janDataFolder,
    })

    if (selectedPath === janDataFolder) return
    if (selectedPath !== null) {
      setSelectedNewPath(selectedPath as string)
      setIsDialogOpen(true)
    }
  }

  const confirmDataFolderChange = async () => {
    if (selectedNewPath) {
      try {
        await serviceHub.models().stopAllModels()
        serviceHub.events().emit(SystemEvent.KILL_SIDECAR)
        setTimeout(async () => {
          try {
            // Prevent relocating to root directory (e.g., C:\ or D:\ on Windows, / on Unix)
            if (isRootDir(selectedNewPath))
              throw new Error(t('settings:general.couldNotRelocateToRoot'))
            await serviceHub.app().relocateJanDataFolder(selectedNewPath)
            setJanDataFolder(selectedNewPath)
            // Only relaunch if relocation was successful
            window.core?.api?.relaunch()
            setSelectedNewPath(null)
            setIsDialogOpen(false)
          } catch (error) {
            console.error(error)
            toast.error(
              error instanceof Error
                ? error.message
                : t('settings:general.failedToRelocateDataFolder')
            )
          }
        }, 1000)
      } catch (error) {
        console.error('Failed to relocate data folder:', error)
        // Revert the data folder path on error
        const originalPath = await serviceHub.app().getJanDataFolder()
        setJanDataFolder(originalPath)

        toast.error(t('settings:general.failedToRelocateDataFolderDesc'))
      }
    }
  }

  const handleCheckForUpdate = useCallback(async () => {
    setIsCheckingUpdate(true)
    try {
      if (isDev()) return toast.info(t('settings:general.devVersion'))
      const update = await checkForUpdate(true)
      if (!update) {
        toast.info(t('settings:general.noUpdateAvailable'))
      }
      // If update is available, the AppUpdater dialog will automatically show
    } catch (error) {
      console.error('Failed to check for updates:', error)
      toast.error(t('settings:general.updateError'))
    } finally {
      setIsCheckingUpdate(false)
    }
  }, [t, checkForUpdate])

  return (
    <div className="flex flex-col h-full pb-[calc(env(safe-area-inset-bottom)+env(safe-area-inset-top))]">
      <HeaderPage>
        <h1 className="font-medium">{t('common:settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full flex-col sm:flex-row">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* General */}
            <Card title={t('common:general')}>
              {PlatformFeatures[PlatformFeature.SYSTEM_INTEGRATIONS] && (
                <CardItem
                  title={t('settings:general.appVersion')}
                  actions={
                    <span className="text-main-view-fg/80 font-medium">
                      v{VERSION}
                    </span>
                  }
                />
              )}
              {!AUTO_UPDATER_DISABLED &&
                PlatformFeatures[PlatformFeature.SYSTEM_INTEGRATIONS] && (
                  <CardItem
                    title={t('settings:general.checkForUpdates')}
                    description={t('settings:general.checkForUpdatesDesc')}
                    className="flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-y-2"
                    actions={
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        onClick={handleCheckForUpdate}
                        disabled={isCheckingUpdate}
                      >
                        <div className="cursor-pointer rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1">
                          {isCheckingUpdate
                            ? t('settings:general.checkingForUpdates')
                            : t('settings:general.checkForUpdates')}
                        </div>
                      </Button>
                    }
                  />
                )}
              <CardItem
                title={t('common:language')}
                actions={<LanguageSwitcher />}
              />
              <CardItem
                title={t('settings:others.spellCheck', {
                  ns: 'settings',
                })}
                description={t('settings:others.spellCheckDesc', {
                  ns: 'settings',
                })}
                actions={
                  <Switch
                    checked={spellCheckChatInput}
                    onCheckedChange={(e) => setSpellCheckChatInput(e)}
                  />
                }
              />
              {PlatformFeatures[PlatformFeature.MODEL_HUB] && (
                <CardItem
                  title={t('settings:general.huggingfaceToken', {
                    ns: 'settings',
                  })}
                  description={t('settings:general.huggingfaceTokenDesc', {
                    ns: 'settings',
                  })}
                  actions={
                    <Input
                      id="hf-token"
                      value={huggingfaceToken || ''}
                      onChange={(e) => setHuggingfaceToken(e.target.value)}
                      placeholder={'hf_xxx'}
                      required
                    />
                  }
                />
              )}
            </Card>

            {/* Data folder - Desktop only */}
            {PlatformFeatures[PlatformFeature.SYSTEM_INTEGRATIONS] && (
              <Card title={t('common:dataFolder')}>
                <CardItem
                  title={t('settings:dataFolder.appData', {
                    ns: 'settings',
                  })}
                  align="start"
                  className="flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-y-2"
                  description={
                    <>
                      <span>
                        {t('settings:dataFolder.appDataDesc', {
                          ns: 'settings',
                        })}
                        &nbsp;
                      </span>
                      <div className="flex items-center gap-2 mt-1 ">
                        <div className="">
                          <span
                            title={janDataFolder}
                            className="bg-main-view-fg/10 text-xs px-1 py-0.5 rounded-sm text-main-view-fg/80 line-clamp-1 w-fit"
                          >
                            {janDataFolder}
                          </span>
                        </div>
                        <button
                          onClick={() =>
                            janDataFolder && copyToClipboard(janDataFolder)
                          }
                          className="cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out p-1"
                          title={
                            isCopied
                              ? t('settings:general.copied')
                              : t('settings:general.copyPath')
                          }
                        >
                          {isCopied ? (
                            <div className="flex items-center gap-1">
                              <IconCopyCheck
                                size={12}
                                className="text-accent"
                              />
                              <span className="text-xs leading-0">
                                {t('settings:general.copied')}
                              </span>
                            </div>
                          ) : (
                            <IconCopy
                              size={12}
                              className="text-main-view-fg/50"
                            />
                          )}
                        </button>
                      </div>
                    </>
                  }
                  actions={
                    <>
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        title={t('settings:dataFolder.appData')}
                        onClick={handleDataFolderChange}
                      >
                        <div className="cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1">
                          <IconFolder
                            size={12}
                            className="text-main-view-fg/50"
                          />
                          <span>{t('settings:general.changeLocation')}</span>
                        </div>
                      </Button>
                      {selectedNewPath && (
                        <ChangeDataFolderLocation
                          currentPath={janDataFolder || ''}
                          newPath={selectedNewPath}
                          onConfirm={confirmDataFolderChange}
                          open={isDialogOpen}
                          onOpenChange={(open) => {
                            setIsDialogOpen(open)
                            if (!open) {
                              setSelectedNewPath(null)
                            }
                          }}
                        >
                          <div />
                        </ChangeDataFolderLocation>
                      )}
                    </>
                  }
                />
                <CardItem
                  title={t('settings:dataFolder.appLogs', {
                    ns: 'settings',
                  })}
                  description={t('settings:dataFolder.appLogsDesc')}
                  className="flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-y-2"
                  actions={
                    <div className="flex items-center gap-2">
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        onClick={handleOpenLogs}
                        title={t('settings:dataFolder.appLogs')}
                      >
                        <div className="cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1">
                          <IconLogs
                            size={12}
                            className="text-main-view-fg/50"
                          />
                          <span>{t('settings:general.openLogs')}</span>
                        </div>
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        onClick={async () => {
                          if (janDataFolder) {
                            try {
                              const logsPath = `${janDataFolder}/logs`
                              await serviceHub
                                .opener()
                                .revealItemInDir(logsPath)
                            } catch (error) {
                              console.error(
                                'Failed to reveal logs folder:',
                                error
                              )
                            }
                          }
                        }}
                        title={t('settings:general.revealLogs')}
                      >
                        <div className="cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1">
                          <IconFolder
                            size={12}
                            className="text-main-view-fg/50"
                          />
                          <span>{openFileTitle()}</span>
                        </div>
                      </Button>
                    </div>
                  }
                />
              </Card>
            )}
            {/* Advanced - Desktop only */}
            {PlatformFeatures[PlatformFeature.SYSTEM_INTEGRATIONS] && (
              <Card title="Advanced">
                <CardItem
                  title={t('settings:others.resetFactory', {
                    ns: 'settings',
                  })}
                  description={t('settings:others.resetFactoryDesc', {
                    ns: 'settings',
                  })}
                  actions={
                    <FactoryResetDialog onReset={resetApp}>
                      <Button variant="destructive" size="sm">
                        {t('common:reset')}
                      </Button>
                    </FactoryResetDialog>
                  }
                />
              </Card>
            )}

            {/* Chat */}
            <Card title="Chat">
              <CardItem
                title="Chat model"
                description="Answers when Auto is picked in the model picker. If it fails or says nothing for 1.5 s, the fallback takes over."
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/50 text-main-view-fg font-medium whitespace-nowrap"
                      >
                        {CHAT_MODELS.find((m) => m.value === chatModel)?.label}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {CHAT_MODELS.map((m) => (
                        <DropdownMenuItem
                          key={m.value}
                          className={`cursor-pointer my-0.5 ${chatModel === m.value ? 'bg-main-view-fg/5' : ''}`}
                          onClick={() => {
                            setChatModel(m.value)
                            setChatModelState(m.value)
                            // Claude has no provider entry in the picker
                            if (
                              useChatAuto.getState().auto &&
                              m.provider !== 'anthropic'
                            )
                              useModelProvider
                                .getState()
                                .selectModelProvider(m.provider, m.model)
                            setChatFallbackState(getChatFallback())
                          }}
                        >
                          {m.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
              <CardItem
                title="Chat fallback"
                description="Tried next when the chat model fails or is slow to start."
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/50 text-main-view-fg font-medium whitespace-nowrap"
                      >
                        {
                          CHAT_MODELS.find((m) => m.value === chatFallback)
                            ?.label
                        }
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {CHAT_MODELS.filter((m) => m.value !== chatModel).map(
                        (m) => (
                          <DropdownMenuItem
                            key={m.value}
                            className={`cursor-pointer my-0.5 ${chatFallback === m.value ? 'bg-main-view-fg/5' : ''}`}
                            onClick={() => {
                              setChatFallback(m.value)
                              setChatFallbackState(m.value)
                            }}
                          >
                            {m.label}
                          </DropdownMenuItem>
                        )
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
              <CardItem
                title="Show tables as lists"
                description="Answers that come back as a table are shown as bullet points, one per row."
                actions={
                  <Switch
                    checked={tablesAsLists}
                    onCheckedChange={(on) => {
                      setTablesAsLists(on)
                      setTablesAsListsState(on)
                    }}
                  />
                }
              />
              <CardItem
                title="Chat thinking"
                description="How long gpt-oss thinks before answering. Low answers sooner."
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/50 text-main-view-fg font-medium whitespace-nowrap"
                      >
                        {
                          CHAT_THINKING_LEVELS.find(
                            (l) => l.value === chatThinking
                          )?.label
                        }
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {CHAT_THINKING_LEVELS.map((l) => (
                        <DropdownMenuItem
                          key={l.value}
                          className={`cursor-pointer my-0.5 ${chatThinking === l.value ? 'bg-main-view-fg/5' : ''}`}
                          onClick={() => {
                            setChatThinking(l.value)
                            setChatThinkingState(l.value)
                          }}
                        >
                          {l.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            </Card>

            {/* Dictation */}
            <Card title="Dictation">
              <CardItem
                title="Dictation engine"
                description="Turns your own voice into text when you tap Left Control or the mic button. Auto runs Cartesia, Soniox and ElevenLabs live and sends as soon as two agree (else a judge picks). Soniox gets your whole dictionary and Cartesia the 100 words that fit."
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/50 text-main-view-fg font-medium whitespace-nowrap"
                      >
                        {
                          DICTATION_ENGINES.find(
                            (e) => e.value === dictationEngine
                          )?.label
                        }
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {DICTATION_ENGINES.map((e) => (
                        <DropdownMenuItem
                          key={e.value}
                          className={`cursor-pointer my-0.5 ${dictationEngine === e.value ? 'bg-main-view-fg/5' : ''}`}
                          onClick={() => {
                            setDictationEngine(e.value)
                            setDictationEngineState(e.value)
                          }}
                        >
                          {e.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
              <CardItem
                title="Microphone"
                description="The mic dictation records from, also used by One answer until you speak. BlackHole is never used."
                actions={
                  <DropdownMenu onOpenChange={loadMics}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/50 text-main-view-fg font-medium max-w-56 truncate"
                      >
                        {micDevice || 'Mac default input'}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {['', ...(mics ?? [])].map((label) => (
                        <DropdownMenuItem
                          key={label || 'default'}
                          className={`cursor-pointer my-0.5 ${micDevice === label ? 'bg-main-view-fg/5' : ''}`}
                          onClick={() => {
                            setMicDevice(label)
                            setMicDeviceState(label)
                            // An open dictation mic moves to it now
                            switchMic()
                          }}
                        >
                          {label || 'Mac default input'}
                        </DropdownMenuItem>
                      ))}
                      {mics === null && (
                        <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
              <CardItem
                title="Keep the mic ready"
                description="Leaves the mic open after your first dictation so the next one starts instantly, with nothing cut off. macOS shows the mic as in use while Hi-chat is open."
                actions={
                  <Switch
                    checked={keepMic}
                    onCheckedChange={(on) => {
                      setKeepMicReady(on)
                      setKeepMicState(on)
                    }}
                  />
                }
              />
            </Card>

            {/* Speaker */}
            <Card title="Speaker">
              <CardItem
                title="Live transcription"
                description="Streams the speaker's audio to ElevenLabs while they talk, so the text is ready the moment they pause. The live engines below need it."
                actions={
                  <Switch
                    checked={liveMode}
                    onCheckedChange={(on) => {
                      setLiveMode(on)
                      setLiveModeState(on)
                    }}
                  />
                }
              />
              <CardItem
                title="Engines beside ElevenLabs"
                description={
                  !liveMode && transcribeMode === 'live-soniox-cartesia'
                    ? 'Live transcription is off, so the speaker uses ElevenLabs alone. Turn it on to stream to Soniox and Cartesia too.'
                    : !liveMode && transcribeMode === 'live'
                      ? 'Live transcription is off, so Grok transcribes each clip after the pause instead of streaming. Turn it on for Grok live.'
                      : 'The judge merges their transcripts with ElevenLabs to fix misheard words. Soniox + Cartesia (the default) get your dictionary. None is fastest.'
                }
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/50 text-main-view-fg font-medium whitespace-nowrap"
                      >
                        {
                          TRANSCRIBE_MODES.find(
                            (m) => m.value === transcribeMode
                          )?.label
                        }
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {TRANSCRIBE_MODES.map((m) => (
                        <DropdownMenuItem
                          key={m.value}
                          className={`cursor-pointer my-0.5 ${transcribeMode === m.value ? 'bg-main-view-fg/5' : ''}`}
                          onClick={() => {
                            setTranscribeMode(m.value)
                            setTranscribeModeState(m.value)
                          }}
                        >
                          {m.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
              <CardItem
                title="Judgement model"
                description="Decides whether a clip is a question worth sending. Cerebras is fastest. Claude needs an Anthropic key in Model Providers."
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/50 text-main-view-fg font-medium whitespace-nowrap"
                      >
                        {
                          JUDGE_MODELS.find((m) => m.value === judgeModel)
                            ?.label
                        }
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {JUDGE_MODELS.map((m) => (
                        <DropdownMenuItem
                          key={m.value}
                          className={`cursor-pointer my-0.5 ${judgeModel === m.value ? 'bg-main-view-fg/5' : ''}`}
                          onClick={() => {
                            setJudgeModel(m.value)
                            setJudgeModelState(m.value)
                          }}
                        >
                          {m.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
              <CardItem
                title="Second judge"
                description="Asks a second model about every clip at the same time. When they agree, that decides; when one would send it and the other wouldn't, the clip shows as a chip next to the speaker button, to send with one click (or F15). Off sends what the first judge decides."
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/50 text-main-view-fg font-medium whitespace-nowrap"
                      >
                        {JUDGE_MODELS.find((m) => m.value === secondJudge)
                          ?.label ?? 'Off'}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {[undefined, ...JUDGE_MODELS.map((m) => m.value)]
                        .filter((v) => v !== judgeModel)
                        .map((value) => (
                          <DropdownMenuItem
                            key={value ?? 'off'}
                            className={`cursor-pointer my-0.5 ${secondJudge === value ? 'bg-main-view-fg/5' : ''}`}
                            onClick={() => {
                              setSecondJudge(value)
                              setSecondJudgeState(value)
                            }}
                          >
                            {JUDGE_MODELS.find((m) => m.value === value)
                              ?.label ?? 'Off'}
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
              <CardItem
                title="Clip types"
                description="The judge also names what kind of clip it heard (question, logistics, repeat...), and a YES for a skip type is dropped. Turn off to compare in the replay below."
                actions={
                  <Switch
                    checked={clipTypes}
                    onCheckedChange={(on) => {
                      setClipTypes(on)
                      setClipTypesState(on)
                    }}
                  />
                }
              />
              <CardItem
                title="Wait for the rest of a question"
                description="Holds a clip that stops mid-question or sets up a scenario, and joins it to the next clip."
                actions={
                  <Switch
                    checked={waitMode}
                    onCheckedChange={(on) => {
                      setWaitMode(on)
                      setWaitModeState(on)
                    }}
                  />
                }
              />
              <CardItem
                title="Smart turn detection"
                description="Listens to the interviewer's voice to tell whether they have finished. A question asked while they sound mid-sentence waits up to 5 s for the rest, or until you start speaking. Its score is logged either way. Downloads a 32 MB model the first time."
                actions={
                  <Switch
                    checked={smartTurn}
                    onCheckedChange={(on) => {
                      setSmartTurn(on)
                      setSmartTurnState(on)
                    }}
                  />
                }
              />
              <CardItem
                title="One answer until you speak"
                description="Uses your microphone to tell when a question is over: everything the interviewer asks before you start talking becomes one question with one answer. Only the mic level is checked; nothing is recorded or sent."
                actions={
                  <Switch
                    checked={micTurns}
                    onCheckedChange={(on) => {
                      setMicTurns(on)
                      setMicTurnsState(on)
                    }}
                  />
                }
              />
              <CardItem
                title="Your dictionary"
                description={`Names and terms the transcription should spell right, one per line or separated by commas (${dictionaryTerms().length} saved).`}
                column
                actions={
                  <Textarea
                    value={dictionary}
                    onChange={(e) => {
                      setDictionaryState(e.target.value)
                      setDictionary(e.target.value)
                    }}
                    placeholder={'Kubernetes\nNAT gateway\nTerraform'}
                    className="min-h-24 max-h-60 w-full"
                  />
                }
              />
            </Card>

            {/* Speaker test */}
            <Card title="Speaker test">
              <CardItem
                title="Compare judgement models"
                description="Runs each judgement model you have a key for on 58 recorded clips and shows how many it gets right, and how fast."
                actions={
                  <div className="flex gap-2">
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0"
                      disabled={benchRunning}
                      onClick={runBench}
                    >
                      <div className="cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1">
                        {benchRunning ? 'Running...' : 'Run test'}
                      </div>
                    </Button>
                    {bench && bench.length > 0 && !benchRunning && (
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        onClick={() => {
                          navigator.clipboard
                            .writeText(formatBench(bench))
                            .then(() => toast.success('Results copied'))
                            .catch(() => toast.error("Couldn't copy"))
                        }}
                      >
                        <div className="cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1">
                          Copy results
                        </div>
                      </Button>
                    )}
                  </div>
                }
              />
              {bench && bench.length > 0 && (
                <div className="text-sm text-main-view-fg/80 px-1 pb-2 space-y-1">
                  {[...bench]
                    .sort(
                      (a, b) => b.right - a.right || a.medianMs - b.medianMs
                    )
                    .map((r) => (
                      <div key={r.judge}>
                        <span className="font-medium text-main-view-fg">
                          {r.label}
                        </span>
                        : {r.right}/{r.total} right, median{' '}
                        {(r.medianMs / 1000).toFixed(2)} s, slowest{' '}
                        {(r.slowestMs / 1000).toFixed(2)} s
                        {r.backup ? `, ${r.backup} answered by backup` : ''}
                      </div>
                    ))}
                </div>
              )}
              <CardItem
                title="Replay labelled interviews"
                description="Replays every labelled clip from your recorded interviews through the speaker filter with your current judge and settings, and counts chatter it would send and questions it would miss, next to what happened live. Takes a few minutes."
                actions={
                  <div className="flex gap-2">
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0"
                      disabled={replayProgress !== null}
                      onClick={runReplay}
                    >
                      <div className="cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1">
                        {replayProgress
                          ? `Running ${replayProgress}`
                          : 'Run replay'}
                      </div>
                    </Button>
                    {replay && (
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        onClick={() => {
                          navigator.clipboard
                            .writeText(formatReplay(replay))
                            .then(() => toast.success('Results copied'))
                            .catch(() => toast.error("Couldn't copy"))
                        }}
                      >
                        <div className="cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1">
                          Copy results
                        </div>
                      </Button>
                    )}
                  </div>
                }
              />
              {replay && (
                <div className="text-sm text-main-view-fg/80 px-1 pb-2 space-y-1">
                  <div>
                    Chatter sent: {replay.now.chatterSent.length} (live{' '}
                    {replay.live.chatterSent.length})
                  </div>
                  <div>
                    Questions missed: {replay.now.missed.length} of{' '}
                    {replay.sends} (live {replay.live.missed.length})
                  </div>
                  <div>
                    Unseen clips only ({replay.unseen.clips} not quoted in the
                    judge's instructions): chatter sent{' '}
                    {replay.unseen.now.chatterSent.length} (live{' '}
                    {replay.unseen.live.chatterSent.length}), missed{' '}
                    {replay.unseen.now.missed.length} of {replay.unseen.sends}{' '}
                    (live {replay.unseen.live.missed.length})
                  </div>
                  {replay.second !== 'off' && (
                    <div>
                      Offered as a chip: {replay.offered.questions} real
                      questions, {replay.offered.chatter} chatter
                    </div>
                  )}
                  <div>
                    Chatter sent by type:{' '}
                    {formatTypes(replay.types.chatterSent)}
                  </div>
                  <div>Missed by type: {formatTypes(replay.types.missed)}</div>
                  <div>
                    Judge median {(replay.medianMs / 1000).toFixed(2)} s,
                    slowest {(replay.slowestMs / 1000).toFixed(2)} s
                    {replay.errors.length
                      ? `, ${replay.errors.length} errors`
                      : ''}
                  </div>
                </div>
              )}
              <CardItem
                title="Compare answer models"
                description={`Asks Claude Haiku 4.5, Haiku 5.5, Sonnet 5.5 and Cerebras ${ANSWER_QUESTIONS.length} real interview questions at the same moment, with your current assistant's instructions, and shows each answer and how fast it started.`}
                actions={
                  <div className="flex gap-2">
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0"
                      disabled={answersRunning}
                      onClick={runAnswers}
                    >
                      <div className="cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1">
                        {answersRunning
                          ? `Running ${answers?.length ?? 0}/${ANSWER_QUESTIONS.length}...`
                          : 'Run test'}
                      </div>
                    </Button>
                    {answers && answers.length > 0 && !answersRunning && (
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        onClick={() => {
                          navigator.clipboard
                            .writeText(formatAnswers(answers))
                            .then(() => toast.success('Answers copied'))
                            .catch(() => toast.error("Couldn't copy"))
                        }}
                      >
                        <div className="cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1">
                          Copy answers
                        </div>
                      </Button>
                    )}
                  </div>
                }
              />
              {answers && answers.length > 0 && (
                <div className="text-sm text-main-view-fg/80 px-1 pb-2 space-y-2">
                  {answerSummary(answers).map((s) => (
                    <div key={s.model}>
                      <span className="font-medium text-main-view-fg">
                        {s.label}
                      </span>
                      : first word{' '}
                      {s.firstMs === undefined
                        ? '–'
                        : `${(s.firstMs / 1000).toFixed(2)} s`}
                      , whole answer{' '}
                      {s.totalMs === undefined
                        ? '–'
                        : `${(s.totalMs / 1000).toFixed(2)} s`}{' '}
                      (median{s.errors ? `, ${s.errors} failed` : ''})
                    </div>
                  ))}
                  {answers.map((r, i) => (
                    <details
                      key={i}
                      className="rounded-sm bg-main-view-fg/4 px-2 py-1"
                    >
                      <summary className="cursor-pointer">
                        {i + 1}. {r.question}
                      </summary>
                      {r.runs.map((x) => (
                        <div key={x.model} className="mt-2">
                          <div className="font-medium text-main-view-fg">
                            {
                              ANSWER_MODELS.find((m) => m.value === x.model)
                                ?.label
                            }{' '}
                            <span className="font-normal text-main-view-fg/60">
                              (first word{' '}
                              {x.firstMs === undefined
                                ? '–'
                                : `${(x.firstMs / 1000).toFixed(2)} s`}
                              , whole{' '}
                              {x.totalMs === undefined
                                ? '–'
                                : `${(x.totalMs / 1000).toFixed(2)} s`}
                              )
                            </span>
                          </div>
                          {x.error && (
                            <div className="text-destructive">{x.error}</div>
                          )}
                          <div className="whitespace-pre-wrap">{x.text}</div>
                        </div>
                      ))}
                    </details>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
