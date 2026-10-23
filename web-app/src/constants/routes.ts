export const route = {
  // home as new chat or thread
  home: '/',
  mirror: '/mirror',
  settings: {
    index: '/settings',
    model_providers: '/settings/providers',
    providers: '/settings/providers/$providerName',
    general: '/settings/general',
    attachments: '/settings/attachments',
    interface: '/settings/interface',
    shortcuts: '/settings/shortcuts',
    app_keys: '/settings/app-keys',
    assistant: '/settings/assistant',
  },
  threadsDetail: '/threads/$threadId',
}
