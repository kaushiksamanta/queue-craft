import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { vi } from 'vitest'
import { ConnectionManager } from '../../src/connection'
import { Worker } from '../../src/worker'
import { WorkerConfig, MessageMetadata, Logger } from '../../src/types'
import { ConsumeMessage } from 'amqplib'

// Silent logger for tests
const silentLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

vi.mock('../../src/connection', () => {
  const mockConsume = vi.fn().mockResolvedValue({ consumerTag: 'test-consumer' })
  const mockCancel = vi.fn().mockResolvedValue({})
  const mockAck = vi.fn()
  const mockNack = vi.fn()
  const mockPublish = vi.fn().mockResolvedValue({})
  const mockSendToQueue = vi.fn().mockResolvedValue({})

  const mockChannel = {
    consume: mockConsume,
    cancel: mockCancel,
    ack: mockAck,
    nack: mockNack,
    publish: mockPublish,
    sendToQueue: mockSendToQueue,
    assertExchange: vi.fn().mockResolvedValue({}),
    assertQueue: vi.fn().mockResolvedValue({ queue: 'test-queue' }),
    bindQueue: vi.fn().mockResolvedValue({}),
    prefetch: vi.fn().mockResolvedValue({}),
  }

  const MockConnectionManager = vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    getChannel: vi.fn().mockResolvedValue(mockChannel),
    assertExchange: vi
      .fn()
      .mockImplementation((name, options) => mockChannel.assertExchange(name, options)),
    assertQueue: vi
      .fn()
      .mockImplementation((name, options) => mockChannel.assertQueue(name, options)),
    bindQueue: vi
      .fn()
      .mockImplementation((queue, exchange, pattern) =>
        mockChannel.bindQueue(queue, exchange, pattern),
      ),
    setPrefetch: vi.fn().mockImplementation(count => mockChannel.prefetch(count)),
    close: vi.fn().mockResolvedValue(undefined),
  }))

  return {
    ConnectionManager: MockConnectionManager,
  }
})

describe('Worker', () => {
  interface TestEventPayloadMap {
    'user.created': { id: string; name: string }
    'user.updated': { id: string; name: string }
  }

  let connectionManager: ConnectionManager
  let worker: Worker<TestEventPayloadMap>
  let handler: ReturnType<typeof vi.fn>

  interface TestMessage {
    content: Buffer
    fields: {
      routingKey: string
      exchange?: string
      deliveryTag?: number
      redelivered?: boolean
      consumerTag?: string
    }
    properties: {
      headers?: Record<string, unknown>
      messageId?: string
      timestamp?: number
    }
  }

  interface WorkerPrivateMethods {
    requeueWithRetryCount(
      msg: ConsumeMessage,
      payload: unknown,
      routingKey: string,
      retryCount: number,
    ): Promise<void>
    sendToDeadLetterQueue(
      msg: ConsumeMessage,
      payload: unknown,
      routingKey: string,
      error?: Error,
    ): Promise<void>
    processMessageWithRetry(
      event: string,
      payload: unknown,
      metadata: MessageMetadata,
      msg: ConsumeMessage,
    ): Promise<void>
  }

  let specificHandlers: {
    'user.created': ReturnType<
      typeof vi.fn<
        [
          payload: { id: string; name: string },
          metadata: import('../../src/types').MessageMetadata,
        ],
        Promise<void>
      >
    >
    'user.updated': ReturnType<
      typeof vi.fn<
        [
          payload: { id: string; name: string },
          metadata: import('../../src/types').MessageMetadata,
        ],
        Promise<void>
      >
    >
  }
  let workerConfig: WorkerConfig<TestEventPayloadMap>

  beforeEach(() => {
    vi.clearAllMocks()

    connectionManager = new ConnectionManager({
      host: 'localhost',
      port: 5672,
      username: 'guest',
      password: 'guest',
      vhost: '/',
    })

    handler = vi.fn().mockResolvedValue(undefined)
    specificHandlers = {
      'user.created': vi
        .fn<
          [
            payload: { id: string; name: string },
            metadata: import('../../src/types').MessageMetadata,
          ],
          Promise<void>
        >()
        .mockResolvedValue(undefined),
      'user.updated': vi
        .fn<
          [
            payload: { id: string; name: string },
            metadata: import('../../src/types').MessageMetadata,
          ],
          Promise<void>
        >()
        .mockResolvedValue(undefined),
    }

    workerConfig = {
      handlers: specificHandlers,
      queueName: 'test-worker-queue',
      options: {
        prefetch: 10,
      },
    }

    worker = new Worker(connectionManager, workerConfig, 'test-exchange')
  })

  afterEach(async () => {
    await worker.close()
  })

  it('should initialize worker', async () => {
    await worker.start()

    expect(connectionManager.connect).toHaveBeenCalled()
    expect(connectionManager.setPrefetch).toHaveBeenCalledWith(10)
    expect(connectionManager.assertExchange).toHaveBeenCalledWith('test-exchange', undefined)
    expect(connectionManager.assertQueue).toHaveBeenCalled()
    expect(connectionManager.bindQueue).toHaveBeenCalledTimes(2)
  })

  it('should start consuming', async () => {
    await worker.start()

    const channel = await connectionManager.getChannel()

    expect(channel.consume).toHaveBeenCalled()
    const consumeMock = channel.consume as unknown as {
      mock: { calls: Array<[string, (msg: TestMessage) => Promise<void>, object]> }
    }
    expect(consumeMock.mock.calls[0][0]).toBe('test-worker-queue')
    expect(typeof consumeMock.mock.calls[0][1]).toBe('function')
  })

  it('should stop consuming', async () => {
    await worker.start()
    await worker.stop()

    const channel = await connectionManager.getChannel()

    expect(channel.cancel).toHaveBeenCalledWith('test-consumer')
  })

  it('should handle message', async () => {
    await worker.start()

    const channel = await connectionManager.getChannel()
    const consumeFn = channel.consume as unknown as {
      mock: { calls: Array<[string, (msg: TestMessage) => Promise<void>, { noAck: boolean }]> }
    }
    const consumeCallback = consumeFn.mock.calls[0][1]

    const message: TestMessage = {
      content: Buffer.from(JSON.stringify({ id: '123', name: 'John' })),
      fields: { routingKey: 'user.created' },
      properties: {
        messageId: 'msg-123',
        timestamp: Date.now(),
        headers: { source: 'test' },
      },
    }

    await consumeCallback(message)

    expect(specificHandlers['user.created']).toHaveBeenCalledWith(
      { id: '123', name: 'John' },
      expect.objectContaining({
        properties: expect.objectContaining({
          messageId: 'msg-123',
        }),
        nack: expect.any(Function),
        requeue: expect.any(Function),
        deadLetter: expect.any(Function),
      }),
    )
  })

  it('should handle message with automatic acknowledgment', async () => {
    worker = new Worker(connectionManager, workerConfig, 'test-exchange', silentLogger)

    await worker.start()

    const channel = await connectionManager.getChannel()
    const consumeFn = channel.consume as unknown as {
      mock: { calls: Array<[string, (msg: TestMessage) => Promise<void>, { noAck: boolean }]> }
    }
    const consumeCallback = consumeFn.mock.calls[0][1]

    const message: TestMessage = {
      content: Buffer.from(JSON.stringify({ id: '123', name: 'John' })),
      fields: { routingKey: 'user.created' },
      properties: {},
    }

    await consumeCallback(message)

    expect(specificHandlers['user.created']).toHaveBeenCalled()
    expect(channel.ack).toHaveBeenCalledWith(message)
  })

  it('should not auto-acknowledge when manual nack is used', async () => {
    specificHandlers['user.created'] = vi.fn().mockImplementation(async (_payload, metadata) => {
      metadata.nack()
      await Promise.resolve()
    })

    await worker.start()

    const channel = await connectionManager.getChannel()
    const consumeFn = channel.consume as unknown as {
      mock: { calls: Array<[string, (msg: TestMessage) => Promise<void>, { noAck: boolean }]> }
    }
    const consumeCallback = consumeFn.mock.calls[0][1]

    const ackSpy = vi.fn()
    const nackSpy = vi.fn()
    channel.ack = ackSpy
    channel.nack = nackSpy

    const message: TestMessage = {
      content: Buffer.from(JSON.stringify({ id: '123', name: 'John' })),
      fields: { routingKey: 'user.created' },
      properties: {
        headers: {},
      },
    }

    await consumeCallback(message)

    expect(specificHandlers['user.created']).toHaveBeenCalled()
    expect(nackSpy).toHaveBeenCalledWith(message, false, false)
    expect(ackSpy).not.toHaveBeenCalled()
  })

  it('should not auto-acknowledge when manual requeue is used', async () => {
    specificHandlers['user.created'] = vi.fn().mockImplementation(async (_payload, metadata) => {
      metadata.requeue()
      await Promise.resolve()
    })

    await worker.start()

    const channel = await connectionManager.getChannel()
    const consumeFn = channel.consume as unknown as {
      mock: { calls: Array<[string, (msg: TestMessage) => Promise<void>, { noAck: boolean }]> }
    }
    const consumeCallback = consumeFn.mock.calls[0][1]

    const ackSpy = vi.fn()
    const nackSpy = vi.fn()
    channel.ack = ackSpy
    channel.nack = nackSpy

    const message: TestMessage = {
      content: Buffer.from(JSON.stringify({ id: '123', name: 'John' })),
      fields: { routingKey: 'user.created' },
      properties: {
        headers: {},
      },
    }

    await consumeCallback(message)

    expect(specificHandlers['user.created']).toHaveBeenCalled()
    expect(nackSpy).toHaveBeenCalledWith(message, false, true)
    expect(ackSpy).not.toHaveBeenCalled()
  })

  it('should not auto-acknowledge when manual deadLetter is used', async () => {
    specificHandlers['user.created'] = vi.fn().mockImplementation(async (_payload, metadata) => {
      await metadata.deadLetter?.()
      await Promise.resolve()
    })

    await worker.start()

    const channel = await connectionManager.getChannel()
    const consumeFn = channel.consume as unknown as {
      mock: { calls: Array<[string, (msg: TestMessage) => Promise<void>, { noAck: boolean }]> }
    }
    const consumeCallback = consumeFn.mock.calls[0][1]

    const ackSpy = vi.fn()
    const dlqSpy = vi
      .spyOn(worker as unknown as WorkerPrivateMethods, 'sendToDeadLetterQueue')
      .mockResolvedValue()
    channel.ack = ackSpy

    const message: TestMessage = {
      content: Buffer.from(JSON.stringify({ id: '123', name: 'John' })),
      fields: { routingKey: 'user.created' },
      properties: {
        headers: {},
      },
    }

    await consumeCallback(message)

    expect(specificHandlers['user.created']).toHaveBeenCalled()
    expect(dlqSpy).toHaveBeenCalled()
    expect(ackSpy).not.toHaveBeenCalled()

    dlqSpy.mockRestore()
  })

  it('should handle error in message processing', async () => {
    handler.mockRejectedValue(new Error('Test error'))
    specificHandlers['user.created'] = vi.fn().mockRejectedValue(new Error('Test error'))

    workerConfig.options = {
      ...workerConfig.options,
      retry: {
        maxRetries: 2,
        initialDelay: 10,
        backoffFactor: 1.5,
        maxDelay: 100,
      },
    }
    worker = new Worker(connectionManager, workerConfig, 'test-exchange')

    const ackSpy = vi.fn()
    const channel = await connectionManager.getChannel()
    channel.ack = ackSpy

    const requeueSpy = vi.spyOn(worker as unknown as WorkerPrivateMethods, 'requeueWithRetryCount')
    requeueSpy.mockImplementation(() => Promise.resolve())

    await worker.start()
    const consumeFn = channel.consume as unknown as {
      mock: { calls: Array<[string, (msg: TestMessage) => Promise<void>, { noAck: boolean }]> }
    }
    const consumeCallback = consumeFn.mock.calls[0][1]

    const message: TestMessage = {
      content: Buffer.from(JSON.stringify({ id: '123', name: 'John' })),
      fields: { routingKey: 'user.created' },
      properties: {
        headers: {},
      },
    }

    await consumeCallback(message)

    expect(specificHandlers['user.created']).toHaveBeenCalled()
    expect(requeueSpy).toHaveBeenCalled()
    expect(ackSpy).toHaveBeenCalledWith(message)

    requeueSpy.mockRestore()
  })

  describe('Queue Naming Strategies', () => {
    it('should use explicit queueName when provided', () => {
      const config: WorkerConfig<TestEventPayloadMap> = {
        handlers: specificHandlers,
        queueName: 'my-custom-queue',
      }

      const customWorker = new Worker(connectionManager, config, 'test-exchange', silentLogger)
      expect(customWorker.getQueueName()).toBe('my-custom-queue')
    })

    it('should keep same queue name when handlers change', () => {
      // This tests that queueName provides stable queue names
      const config1: WorkerConfig<TestEventPayloadMap> = {
        handlers: {
          'user.created': specificHandlers['user.created'],
        },
        queueName: 'user-service',
      }

      const config2: WorkerConfig<TestEventPayloadMap> = {
        handlers: {
          'user.created': specificHandlers['user.created'],
          'user.updated': specificHandlers['user.updated'],
        },
        queueName: 'user-service',
      }

      const worker1 = new Worker(connectionManager, config1, 'test-exchange', silentLogger)
      const worker2 = new Worker(connectionManager, config2, 'test-exchange', silentLogger)

      // Both should have the same queue name regardless of handlers
      expect(worker1.getQueueName()).toBe('user-service')
      expect(worker2.getQueueName()).toBe('user-service')
    })

    it('should throw error when explicit queueName exceeds 255 characters', () => {
      const longName = 'a'.repeat(256)
      const config: WorkerConfig<TestEventPayloadMap> = {
        handlers: specificHandlers,
        queueName: longName,
      }

      expect(() => {
        new Worker(connectionManager, config, 'test-exchange', silentLogger)
      }).toThrow(/exceeds RabbitMQ limit of 255 characters/)
    })

  })

  describe('Dynamic Handler Registration', () => {
    it('should add handler before start', async () => {
      interface ExtendedEventMap extends TestEventPayloadMap {
        'user.deleted': { id: string }
      }

      const config: WorkerConfig<ExtendedEventMap> = {
        handlers: {
          'user.created': vi.fn().mockResolvedValue(undefined),
        },
        queueName: 'test-queue',
      }

      const customWorker = new Worker<ExtendedEventMap>(
        connectionManager,
        config,
        'test-exchange',
        silentLogger,
      )

      const newHandler = vi.fn().mockResolvedValue(undefined)
      await customWorker.addHandler('user.deleted', newHandler)

      // Handler should be added but not bound yet (not consuming)
      expect(connectionManager.bindQueue).not.toHaveBeenCalledWith(
        'test-queue',
        'test-exchange',
        'user.deleted',
      )

      await customWorker.close()
    })

    it('should add and bind handler after start', async () => {
      interface ExtendedEventMap extends TestEventPayloadMap {
        'user.deleted': { id: string }
      }

      const config: WorkerConfig<ExtendedEventMap> = {
        handlers: {
          'user.created': vi.fn().mockResolvedValue(undefined),
        },
        queueName: 'dynamic-test-queue',
      }

      const customWorker = new Worker<ExtendedEventMap>(
        connectionManager,
        config,
        'test-exchange',
        silentLogger,
      )

      await customWorker.start()

      // Clear previous calls
      vi.mocked(connectionManager.bindQueue).mockClear()

      const newHandler = vi.fn().mockResolvedValue(undefined)
      await customWorker.addHandler('user.deleted', newHandler)

      // Handler should be bound immediately since worker is consuming
      expect(connectionManager.bindQueue).toHaveBeenCalledWith(
        'dynamic-test-queue',
        'test-exchange',
        'user.deleted',
      )

      await customWorker.close()
    })

    it('should remove handler', () => {
      const config: WorkerConfig<TestEventPayloadMap> = {
        handlers: specificHandlers,
        queueName: 'test-queue',
      }

      const customWorker = new Worker(connectionManager, config, 'test-exchange', silentLogger)
      customWorker.removeHandler('user.created')

      // Verify handler was removed by checking logger was called
      expect(silentLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Removed handler for event 'user.created'"),
      )
    })
  })
})
