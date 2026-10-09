/**
 * Web Conversational Extension
 * Stores threads and messages in the browser (IndexedDB). Nothing leaves the
 * device except the chat requests sent to the model provider.
 */

import {
  Thread,
  ThreadMessage,
  ConversationalExtension,
  ThreadAssistantInfo,
} from '@janhq/core'
import {
  STORES,
  get,
  getAll,
  getByThread,
  put,
  remove,
  removeByThread,
} from './db'

export default class ConversationalExtensionWeb extends ConversationalExtension {
  async onLoad() {
    console.log('Loading Web Conversational Extension (browser storage)')
  }

  onUnload() {}

  // Thread Management
  async listThreads(): Promise<Thread[]> {
    try {
      const threads = await getAll<Thread>(STORES.threads)
      return threads.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
    } catch (error) {
      console.error('Failed to list threads:', error)
      return []
    }
  }

  async createThread(thread: Thread): Promise<Thread> {
    await put(STORES.threads, thread)
    return thread
  }

  async modifyThread(thread: Thread): Promise<void> {
    await put(STORES.threads, thread)
  }

  async deleteThread(threadId: string): Promise<void> {
    await removeByThread(threadId)
    await remove(STORES.threads, threadId)
  }

  // Message Management
  async createMessage(message: ThreadMessage): Promise<ThreadMessage> {
    await put(STORES.messages, message)
    return message
  }

  async listMessages(threadId: string): Promise<ThreadMessage[]> {
    try {
      const messages = await getByThread<ThreadMessage>(threadId)
      return messages.sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0))
    } catch (error) {
      console.error('Failed to list messages:', error)
      return []
    }
  }

  async modifyMessage(message: ThreadMessage): Promise<ThreadMessage> {
    await put(STORES.messages, message)
    return message
  }

  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    await remove(STORES.messages, messageId)
  }

  // Thread assistants are kept on the thread record itself
  async getThreadAssistant(threadId: string): Promise<ThreadAssistantInfo> {
    const thread = await get<Thread>(STORES.threads, threadId)
    const assistant = thread?.assistants?.[0]
    if (!assistant) throw new Error(`No assistant for thread ${threadId}`)
    return assistant
  }

  async createThreadAssistant(
    threadId: string,
    assistant: ThreadAssistantInfo
  ): Promise<ThreadAssistantInfo> {
    return this.saveThreadAssistant(threadId, assistant)
  }

  async modifyThreadAssistant(
    threadId: string,
    assistant: ThreadAssistantInfo
  ): Promise<ThreadAssistantInfo> {
    return this.saveThreadAssistant(threadId, assistant)
  }

  async getThreadAssistantInfo(
    threadId: string
  ): Promise<ThreadAssistantInfo | undefined> {
    const thread = await get<Thread>(STORES.threads, threadId)
    return thread?.assistants?.[0]
  }

  private async saveThreadAssistant(
    threadId: string,
    assistant: ThreadAssistantInfo
  ): Promise<ThreadAssistantInfo> {
    const thread = await get<Thread>(STORES.threads, threadId)
    if (thread) {
      await put(STORES.threads, { ...thread, assistants: [assistant] })
    }
    return assistant
  }
}
