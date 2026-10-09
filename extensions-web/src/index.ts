/**
 * Web Extensions Package
 * Contains browser-compatible extensions for Jan AI
 */

import type { WebExtensionRegistry } from './types'

export { default as ConversationalExtensionWeb } from './conversational-web'

// Re-export types
export type {
  WebExtensionRegistry,
  WebExtensionModule,
  WebExtensionName,
  WebExtensionLoader,
  ConversationalWebModule,
} from './types'

// Extension registry for dynamic loading
export const WEB_EXTENSIONS: WebExtensionRegistry = {
  'conversational-web': () => import('./conversational-web'),
}
