/**
 * Web Extension Types
 */

import type { ConversationalExtension, BaseExtension } from '@janhq/core'

type ExtensionConstructorParams = ConstructorParameters<typeof BaseExtension>

export interface ConversationalWebModule {
  default: new (...args: ExtensionConstructorParams) => ConversationalExtension
}

export type WebExtensionModule = ConversationalWebModule

export interface WebExtensionRegistry {
  'conversational-web': () => Promise<ConversationalWebModule>
}

export type WebExtensionName = keyof WebExtensionRegistry

export type WebExtensionLoader<T extends WebExtensionName> = WebExtensionRegistry[T]

export interface IndexedDBConfig {
  dbName: string
  version: number
  stores: {
    name: string
    keyPath: string
    indexes?: { name: string; keyPath: string | string[]; unique?: boolean }[]
  }[]
}
