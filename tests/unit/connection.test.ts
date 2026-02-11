import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ConnectionManager } from '../../src/connection'
import * as amqp from 'amqplib'

interface MockChannel {
  assertExchange: ReturnType<typeof vi.fn>
  assertQueue: ReturnType<typeof vi.fn>
  bindQueue: ReturnType<typeof vi.fn>
  prefetch: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
}

interface MockConnection {
  createChannel: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

interface AmqpMockModule {
  connect: ReturnType<typeof vi.fn>
  __mockChannel: MockChannel
  __mockConnection: MockConnection
}

vi.mock('amqplib', () => {
  const channel: MockChannel = {
    assertExchange: vi.fn().mockResolvedValue({ exchange: 'test-exchange' }),
    assertQueue: vi
      .fn()
      .mockResolvedValue({ queue: 'test-queue', messageCount: 0, consumerCount: 0 }),
    bindQueue: vi.fn().mockResolvedValue({}),
    prefetch: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue({}),
    on: vi.fn(),
    removeListener: vi.fn(),
  }

  const connection: MockConnection = {
    createChannel: vi.fn().mockResolvedValue(channel),
    on: vi.fn(),
    removeListener: vi.fn(),
    close: vi.fn().mockResolvedValue({}),
  }

  return {
    connect: vi.fn().mockResolvedValue(connection),
    __mockChannel: channel,
    __mockConnection: connection,
  }
})

describe('ConnectionManager', () => {
  let connectionManager: ConnectionManager
  const connectionOptions = {
    host: 'localhost',
    port: 5672,
    username: 'guest',
    password: 'guest',
  }

  const getMocks = (): { mockChannel: MockChannel; mockConnection: MockConnection } => {
    const mockedAmqp = amqp as unknown as AmqpMockModule
    return {
      mockChannel: mockedAmqp.__mockChannel,
      mockConnection: mockedAmqp.__mockConnection,
    }
  }

  beforeEach(() => {
    connectionManager = new ConnectionManager(connectionOptions)
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await connectionManager.close()
  })

  it('should connect to RabbitMQ', async () => {
    await connectionManager.connect()

    expect(amqp.connect).toHaveBeenCalledWith(
      'amqp://guest:guest@localhost:5672',
      expect.any(Object),
    )
  })

  it('should reuse existing connection', async () => {
    await connectionManager.connect()
    await connectionManager.connect()

    expect(amqp.connect).toHaveBeenCalledTimes(1)
  })

  it('should get channel', async () => {
    const channel = await connectionManager.getChannel()

    expect(channel).toBeDefined()
    expect(amqp.connect).toHaveBeenCalledTimes(1)
  })

  it('should assert exchange', async () => {
    await connectionManager.assertExchange('test-exchange')

    const { mockChannel } = getMocks()
    expect(mockChannel.assertExchange).toHaveBeenCalledWith(
      'test-exchange',
      'topic',
      expect.objectContaining({
        durable: true,
        autoDelete: false,
      }),
    )
  })

  it('should assert queue', async () => {
    await connectionManager.assertQueue('test-queue')

    const { mockChannel } = getMocks()
    expect(mockChannel.assertQueue).toHaveBeenCalledWith(
      'test-queue',
      expect.objectContaining({
        durable: true,
        autoDelete: false,
        exclusive: false,
      }),
    )
  })

  it('should bind queue to exchange', async () => {
    await connectionManager.bindQueue('test-queue', 'test-exchange', 'test-pattern')

    const { mockChannel } = getMocks()
    expect(mockChannel.bindQueue).toHaveBeenCalledWith(
      'test-queue',
      'test-exchange',
      'test-pattern',
    )
  })

  it('should set prefetch count', async () => {
    await connectionManager.setPrefetch(10)

    const { mockChannel } = getMocks()
    expect(mockChannel.prefetch).toHaveBeenCalledWith(10)
  })

  it('should close connection', async () => {
    await connectionManager.connect()
    await connectionManager.close()

    const { mockChannel, mockConnection } = getMocks()
    expect(mockChannel.close).toHaveBeenCalled()
    expect(mockConnection.close).toHaveBeenCalled()
  })

  it('should not throw when connection emits error without listeners', async () => {
    await connectionManager.connect()

    const { mockConnection } = getMocks()
    type ErrorHandlerCall = [string, (err: Error) => void]
    const errorHandlerCall = mockConnection.on.mock.calls.find(
      (call): call is ErrorHandlerCall => call[0] === 'error'
    )
    const errorHandler = errorHandlerCall?.[1]

    expect(errorHandler).toBeDefined()
    expect(() => errorHandler!(new Error('connection failure'))).not.toThrow()
  })
})
