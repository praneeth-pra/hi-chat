import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initializeServiceHub, type ServiceHub } from '../index'

// Mock platform detection
vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: vi.fn().mockReturnValue(false),
  isPlatformIOS: vi.fn().mockReturnValue(false),
  isPlatformAndroid: vi.fn().mockReturnValue(false),
  isIOS: vi.fn().mockReturnValue(false),
  isAndroid: vi.fn().mockReturnValue(false)
}))

// Mock @jan/extensions-web to return empty extensions for testing
vi.mock('@jan/extensions-web', () => ({
  WEB_EXTENSIONS: {}
}))

// Mock @janhq/core EngineManager to prevent initialization issues
vi.mock('@janhq/core', () => ({
  EngineManager: {
    instance: vi.fn(() => ({
      engines: new Map()
    }))
  }
}))

// Mock ExtensionManager to avoid initialization issues
vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: vi.fn(() => ({
      getEngine: vi.fn()
    }))
  }
}))

// Mock dynamic imports for web services
vi.mock('../theme/web', () => ({
  WebThemeService: vi.fn().mockImplementation(() => ({
    setTheme: vi.fn(),
    getCurrentWindow: vi.fn()
  }))
}))

vi.mock('../app/web', () => ({
  WebAppService: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('../path/web', () => ({
  WebPathService: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('../core/web', () => ({
  WebCoreService: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('../dialog/web', () => ({
  WebDialogService: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('../events/web', () => ({
  WebEventsService: vi.fn().mockImplementation(() => ({
    emit: vi.fn(),
    listen: vi.fn()
  }))
}))

vi.mock('../window/web', () => ({
  WebWindowService: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('../deeplink/web', () => ({
  WebDeepLinkService: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('../providers/web', () => ({
  WebProvidersService: vi.fn().mockImplementation(() => ({}))
}))

// Mock console to avoid noise in tests
vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

describe('ServiceHub Integration Tests', () => {
  let serviceHub: ServiceHub

  beforeEach(async () => {
    vi.clearAllMocks()
    serviceHub = await initializeServiceHub()
  })

  describe('ServiceHub Initialization', () => {
    it('should initialize with the web services', async () => {
      serviceHub = await initializeServiceHub()

      expect(serviceHub).toBeDefined()
      expect(serviceHub.providers()).toBeDefined()
    })
  })

  describe('Service Access', () => {
    it('should provide access to all required services', () => {
      const services = [
        'theme', 'window', 'events', 'hardware', 'app', 'analytic',
        'messages', 'mcp', 'threads', 'providers', 'models', 'assistants',
        'dialog', 'opener', 'updater', 'path', 'core', 'deeplink'
      ]

      services.forEach(serviceName => {
        expect(typeof serviceHub[serviceName as keyof ServiceHub]).toBe('function')
        expect(serviceHub[serviceName as keyof ServiceHub]()).toBeDefined()
      })
    })

    it('should return same service instance on multiple calls', () => {
      const themeService1 = serviceHub.theme()
      const themeService2 = serviceHub.theme()
      
      expect(themeService1).toBe(themeService2)
    })
  })

  describe('Basic Service Functionality', () => {
    it('should have working theme service', () => {
      const theme = serviceHub.theme()
      
      expect(typeof theme.setTheme).toBe('function')
      expect(typeof theme.getCurrentWindow).toBe('function')
    })

    it('should have working events service', () => {
      const events = serviceHub.events()
      
      expect(typeof events.emit).toBe('function')
      expect(typeof events.listen).toBe('function')
    })

  })
})
