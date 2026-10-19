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
import {
  dataFileName,
  exportData,
  importData,
  parseDataFile,
} from '@/lib/dataTransfer'
import { isDev } from '@/lib/utils'
import { checkAppForUpdates, useAppTyping } from '@/lib/remoteKeys'
import { SystemEvent } from '@/types/events'
import { Input } from '@/components/ui/input'
import { useHardware } from '@/hooks/useHardware'
import LanguageSwitcher from '@/containers/LanguageSwitcher'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import { isRootDir } from '@/utils/path'
import {
  DICTATION_ENGINES,
  AUTO_ENGINE_CHOICES,
  getAutoEngines,
  setAutoEngines,
  getDictationEngine,
  getDictationReduceEcho,
  setDictationReduceEcho,
  getKeepMicReady,
  setDictationEngine,
  setKeepMicReady,
  switchMic,
} from '@/lib/dictation'
import { Textarea } from '@/components/ui/textarea'
import { dictionaryTerms, getDictionary, setDictionary } from '@/lib/keyTerms'
import { getDictationMic, listMics, setDictationMic } from '@/lib/micActivity'
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
import { useChatAuto } from '@/lib/chatModels'
import { AUTO_MODES } from '@/lib/autoRace'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  DICTATION_JUDGES,
  getDictationJudges,
  setDictationJudges,
} from '@/lib/dictationJudge'
const ENGINE_LABELS: Record<string, string> = {
  cartesia: 'Cartesia',
  soniox: 'Soniox',
  elevenlabs: 'ElevenLabs',
  grok: 'Grok',
  muse: 'Muse',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.general as any)({
  component: General,
})

function General() {
  const { t } = useTranslation()
  const inApp = useAppTyping((s) => s.inApp)
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
  const [dictationEngine, setDictationEngineState] =
    useState(getDictationEngine)
  const [reduceDictationEcho, setReduceDictationEchoState] = useState(
    getDictationReduceEcho
  )
  const [keepMic, setKeepMicState] = useState(getKeepMicReady)
  const [judges, setJudgesState] = useState(getDictationJudges)
  const [autoEngines, setAutoEnginesState] = useState(getAutoEngines)
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
  const autoMode = useChatAuto((state) => state.mode)
  const setAutoMode = useChatAuto((state) => state.setMode)
  const [chatThinking, setChatThinkingState] =
    useState<ChatThinking>(getChatThinking)
  const [dictationMic, setDictationMicState] = useState(getDictationMic)
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
        <div className="p-4 w-full h-[calc(100%-48px)] overflow-y-auto">
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
              {inApp && (
                <CardItem
                  title="Check for updates"
                  description="Looks for a new version of the Hi-chat app and offers to install it."
                  className="flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-y-2"
                  actions={
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0"
                      onClick={() => checkAppForUpdates()}
                    >
                      <div className="cursor-pointer rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1">
                        Check for updates
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
                title="Auto mode"
                description="Speed races Groq 20B, Groq 120B and Cerebras 120B. Accuracy prefers the two 120B models, with 20B as recovery. Both stream one answer and cancel unused requests. Racing can increase API usage; larger models do not guarantee correctness. Applies when Auto is selected; manually selected models keep their own settings."
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-1 px-2.5 py-1 rounded-lg border border-main-view-fg/10 bg-main-view-fg/[0.04] hover:bg-main-view-fg/[0.08] transition-colors text-sm"
                      >
                        {
                          AUTO_MODES.find((mode) => mode.value === autoMode)
                            ?.label
                        }
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {AUTO_MODES.map((mode) => (
                        <DropdownMenuItem
                          key={mode.value}
                          onClick={() => setAutoMode(mode.value)}
                        >
                          {mode.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
              <CardItem
                title="Answer format"
                description="Bullet points only, starting with a direct answer; how many depends on the question. Tables in answers are always displayed as lists."
              />
              <CardItem
                title="Chat thinking"
                description="Applies to manually selected gpt-oss models. Auto Speed uses Low; Auto Accuracy uses Medium."
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-1 px-2.5 py-1 rounded-lg border border-main-view-fg/10 bg-main-view-fg/[0.04] hover:bg-main-view-fg/[0.08] transition-colors text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/50 text-main-view-fg font-medium whitespace-nowrap"
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
                description="Turns your voice into text (Left Control or the mic button)."
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-1 px-2.5 py-1 rounded-lg border border-main-view-fg/10 bg-main-view-fg/[0.04] hover:bg-main-view-fg/[0.08] transition-colors text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/50 text-main-view-fg font-medium whitespace-nowrap"
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
              {dictationEngine === 'auto' && (
                <CardItem
                  title="Auto engines"
                  description="Race live; sent as soon as two agree."
                  actions={
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="flex cursor-pointer items-center gap-1 px-2.5 py-1 rounded-lg border border-main-view-fg/10 bg-main-view-fg/[0.04] hover:bg-main-view-fg/[0.08] transition-colors text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/50 text-main-view-fg font-medium max-w-56 truncate"
                        >
                          {autoEngines.map((e) => ENGINE_LABELS[e]).join(', ')}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {AUTO_ENGINE_CHOICES.map((e) => (
                          <DropdownMenuCheckboxItem
                            key={e}
                            className="cursor-pointer my-0.5"
                            checked={autoEngines.includes(e)}
                            // The last engine can't be unticked
                            disabled={
                              autoEngines.length === 1 && autoEngines[0] === e
                            }
                            onSelect={(event) => event.preventDefault()}
                            onCheckedChange={(on) => {
                              const next = AUTO_ENGINE_CHOICES.filter((c) =>
                                c === e ? on : autoEngines.includes(c)
                              )
                              setAutoEngines(next)
                              setAutoEnginesState(next)
                            }}
                          >
                            {ENGINE_LABELS[e]}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  }
                />
              )}
              <CardItem
                title="Dictation judges"
                description="Write the final text when the engines disagree. Fastest answer wins."
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-1 px-2.5 py-1 rounded-lg border border-main-view-fg/10 bg-main-view-fg/[0.04] hover:bg-main-view-fg/[0.08] transition-colors text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/50 text-main-view-fg font-medium max-w-56 truncate"
                      >
                        {judges.length
                          ? DICTATION_JUDGES.filter((j) =>
                              judges.includes(j.value)
                            )
                              .map((j) => j.label)
                              .join(', ')
                          : 'None (vote only)'}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {DICTATION_JUDGES.map((j) => (
                        <DropdownMenuCheckboxItem
                          key={j.value}
                          className="cursor-pointer my-0.5"
                          checked={judges.includes(j.value)}
                          onSelect={(e) => e.preventDefault()}
                          onCheckedChange={(on) => {
                            const next = on
                              ? [...judges, j.value]
                              : judges.filter((v) => v !== j.value)
                            setDictationJudges(next)
                            setJudgesState(next)
                          }}
                        >
                          {j.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
              <CardItem
                title="Microphone"
                description="The mic dictation records from."
                actions={
                  <DropdownMenu onOpenChange={loadMics}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-1 px-2.5 py-1 rounded-lg border border-main-view-fg/10 bg-main-view-fg/[0.04] hover:bg-main-view-fg/[0.08] transition-colors text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/50 text-main-view-fg font-medium max-w-56 truncate"
                      >
                        {dictationMic || 'Mac default input'}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {['', ...(mics ?? [])].map((label) => (
                        <DropdownMenuItem
                          key={label || 'default'}
                          className={`cursor-pointer my-0.5 ${dictationMic === label ? 'bg-main-view-fg/5' : ''}`}
                          onClick={() => {
                            setDictationMic(label)
                            setDictationMicState(label)
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
                title="Suppress playback through the microphone"
                description="Reduces speaker echo and background noise."
                actions={
                  <Switch
                    checked={reduceDictationEcho}
                    onCheckedChange={(on) => {
                      setDictationReduceEcho(on)
                      setReduceDictationEchoState(on)
                    }}
                  />
                }
              />
              <CardItem
                title="Keep the mic ready"
                description="Starts dictation instantly with nothing cut off."
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
              <CardItem
                title="Your dictionary"
                description={`Names and terms to spell right (${dictionaryTerms().length} saved).`}
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

            {/* Data */}
            <Card title="Your data">
              <CardItem
                title="Move your chats and settings"
                description="Saves every chat, API key and setting in this browser to a file. Import it in another browser or the Hi-chat Mac app; chats there with the same id are replaced."
                actions={
                  <div className="flex gap-2">
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0"
                      onClick={() => {
                        exportData()
                          .then((data) => {
                            const url = URL.createObjectURL(
                              new Blob([JSON.stringify(data)], {
                                type: 'application/json',
                              })
                            )
                            const a = document.createElement('a')
                            a.href = url
                            a.download = dataFileName()
                            a.click()
                            setTimeout(() => URL.revokeObjectURL(url), 60_000)
                          })
                          .catch((e) =>
                            toast.error(`Export failed: ${String(e)}`)
                          )
                      }}
                    >
                      <div className="cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1">
                        Export
                      </div>
                    </Button>
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0"
                      onClick={() => {
                        const input = document.createElement('input')
                        input.type = 'file'
                        input.accept = 'application/json,.json'
                        input.onchange = () => {
                          const picked = input.files?.[0]
                          if (!picked) return
                          picked
                            .text()
                            .then((text) => importData(parseDataFile(text)))
                            .then(({ chats }) => {
                              toast.success(
                                `Imported ${chats} chats. Reloading...`
                              )
                              setTimeout(() => window.location.reload(), 1200)
                            })
                            .catch((e) =>
                              toast.error(
                                e instanceof Error ? e.message : String(e)
                              )
                            )
                        }
                        input.click()
                      }}
                    >
                      <div className="cursor-pointer flex items-center justify-center rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1 gap-1">
                        Import
                      </div>
                    </Button>
                  </div>
                }
              />
            </Card>

            {/* Answer models */}
            <Card title="Answer model test">
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
