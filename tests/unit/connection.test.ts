import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ConnectionManager } from '../../src/connection'
import * as amqp from 'amqplib'

vi.mock('amqplib', () => {
  const mockChannel = {
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

  const mockConnection = {
    createChannel: vi.fn().mockResolvedValue(mockChannel),
    on: vi.fn(),
    removeListener: vi.fn(),
    close: vi.fn().mockResolvedValue({}),
  }

  return {
    connect: vi.fn().mockResolvedValue(mockConnection),
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

    const mockConnection = await (amqp.connect as any)()
    const mockChannel = await mockConnection.createChannel()

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

    const mockConnection = await (amqp.connect as any)()
    const mockChannel = await mockConnection.createChannel()

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

    const mockConnection = await (amqp.connect as any)()
    const mockChannel = await mockConnection.createChannel()

    expect(mockChannel.bindQueue).toHaveBeenCalledWith(
      'test-queue',
      'test-exchange',
      'test-pattern',
    )
  })

  it('should set prefetch count', async () => {
    await connectionManager.setPrefetch(10)

    const mockConnection = await (amqp.connect as any)()
    const mockChannel = await mockConnection.createChannel()

    expect(mockChannel.prefetch).toHaveBeenCalledWith(10)
  })

  it('should close connection', async () => {
    await connectionManager.connect()
    await connectionManager.close()

    const mockConnection = await (amqp.connect as any)()
    const mockChannel = await mockConnection.createChannel()

    expect(mockChannel.close).toHaveBeenCalled()
    expect(mockConnection.close).toHaveBeenCalled()
  })
})
