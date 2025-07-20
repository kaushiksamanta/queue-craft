import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { vi } from 'vitest'
import { ConnectionManager } from '../../src/connection'
import { Worker } from '../../src/worker'
import { WorkerConfig, MessageMetadata } from '../../src/types'
import { ConsumeMessage } from 'amqplib'

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
    expect(consumeMock.mock.calls[0][0]).toBe('queue.user.created.user.updated')
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
    worker = new Worker(connectionManager, workerConfig, 'test-exchange')

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
})
