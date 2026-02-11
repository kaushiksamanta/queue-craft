import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { QueueCraft } from '../../src/index'
import { MessageMetadata } from '../../src/types'
import {
  ErrorTestPayload,
  OrderPlacedPayload,
  RetryTestPayload,
  TestEventPayloadMap,
  TestWorker,
  UserCreatedPayload,
} from './types'

describe('Integration: Publisher and Worker', () => {
  const exchangeName = `test-exchange-${Date.now()}-${Math.floor(Math.random() * 1000)}`

  const exchangeOptions = {
    type: 'topic' as const,
    durable: false,
    autoDelete: false,
  }

  const queueCraft = new QueueCraft<TestEventPayloadMap>({
    connection: {
      host: process.env.RABBITMQ_HOST || 'localhost',
      port: parseInt(process.env.RABBITMQ_PORT || '5672', 10),
      username: process.env.RABBITMQ_USERNAME || 'guest',
      password: process.env.RABBITMQ_PASSWORD || 'guest',
      vhost: process.env.RABBITMQ_VHOST || '/',

      timeout: 2000,

      heartbeat: 5,
    },
  })

  const publisher = queueCraft.createPublisher(exchangeName, {
    exchange: exchangeOptions,
  })

  let worker: TestWorker | undefined
  let messageCount = 0
  let errorCount = 0

  beforeEach(async () => {
    messageCount = 0
    errorCount = 0
  })

  afterEach(async () => {
    if (worker) {
      try {
        await worker.stop()
      } catch (error) {
        console.log(
          'Error stopping worker:',
          error instanceof Error ? error.message : String(error),
        )
      }
      worker = undefined
    }
  })

  afterAll(async () => {
    try {
      await queueCraft.close()
      console.log('RabbitMQ connection closed successfully')
    } catch (error) {
      console.error(
        'Error closing RabbitMQ connection:',
        error instanceof Error ? error.message : String(error),
      )
    }
  }, 5000)

  let messageProcessed: Promise<void>

  const assertWorker = (): TestWorker => {
    if (!worker) {
      throw new Error('Worker is undefined - worker initialization may have failed')
    }
    return worker
  }

  const createTimeout = (ms: number, errorMessage: string) => {
    return new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error(`${errorMessage} (waited ${ms}ms)`)), ms),
    )
  }

  it('should publish and consume messages', async () => {
    messageProcessed = new Promise<void>(resolve => {
      worker = queueCraft.createWorker(
        {
          queueName: `test-user-created-${Date.now()}`,
          handlers: {
            'user.created': async (payload: UserCreatedPayload, metadata: MessageMetadata) => {
              messageCount++

              expect(payload.id).toBe('123')
              expect(payload.name).toBe('Test User')

              expect(metadata.properties).toBeDefined()
              expect(metadata.properties.headers).toBeDefined()

              resolve()
            },
          },
          options: {
            queue: {
              durable: false,
              autoDelete: true,
            },
          },
        },
        exchangeName,
      )
    })

    await assertWorker().start()

    await publisher.publish('user.created', {
      id: '123',
      name: 'Test User',
      email: 'test@example.com',
      createdAt: new Date().toISOString(),
    })

    await Promise.race([
      messageProcessed,
      createTimeout(10000, 'Timeout waiting for user.created message to be processed'),
    ])

    expect(messageCount, 'Expected exactly one message to be processed').toBe(1)
  })

  it('should handle multiple event types', async () => {
    const userMessageProcessed = new Promise<void>(resolve => {
      worker = queueCraft.createWorker(
        {
          queueName: `test-multiple-events-${Date.now()}`,
          handlers: {
            'user.created': async (payload: UserCreatedPayload, _metadata: MessageMetadata) => {
              messageCount++

              expect(payload.id).toBe('123')
              expect(payload.name).toBe('Test User')

              resolve()
            },
            'order.placed': async (payload: OrderPlacedPayload, _metadata: MessageMetadata) => {
              messageCount++

              expect(payload.id).toBe('456')
              expect(payload.userId).toBe('123')
              expect(payload.total).toBe(99.99)
            },
          },
          options: {
            queue: {
              durable: false,
              autoDelete: true,
            },
          },
        },
        exchangeName,
      )
    })

    await assertWorker().start()

    await publisher.publish('user.created', {
      id: '123',
      name: 'Test User',
      email: 'test@example.com',
      createdAt: new Date().toISOString(),
    })
    await publisher.publish('order.placed', {
      id: '456',
      userId: '123',
      items: [{ productId: 'prod-1', quantity: 1, price: 99.99 }],
      total: 99.99,
      placedAt: new Date().toISOString(),
    })

    await Promise.race([
      userMessageProcessed,
      createTimeout(5000, 'Timeout waiting for user.created message in multiple event test'),
    ])

    await new Promise(resolve => setTimeout(resolve, 1000))

    expect(
      messageCount,
      'Expected two messages to be processed (user.created and order.placed)',
    ).toBe(2)
  })

  it('should handle errors and retry messages', async () => {
    const errorHandled = new Promise<void>(resolve => {
      worker = queueCraft.createWorker(
        {
          queueName: `test-error-retry-${Date.now()}`,
          handlers: {
            'error.test': async (payload: ErrorTestPayload, _metadata: MessageMetadata) => {
              messageCount++
              if (payload.shouldFail) {
                errorCount++

                if (errorCount >= 3) {
                  resolve()
                }

                throw new Error('Test error')
              }
            },
          },
          options: {
            queue: {
              durable: false,
              autoDelete: true,
            },
            retry: {
              maxRetries: 3,
              initialDelay: 100,
              backoffFactor: 1,
              maxDelay: 1000,
            },
          },
        },
        exchangeName,
      )
    })

    await assertWorker().start()

    await publisher.publish('error.test', { shouldFail: true })

    await Promise.race([
      errorHandled,
      createTimeout(5000, 'Timeout waiting for error retry handling'),
    ])

    expect(
      errorCount,
      'Expected at least 3 error processing attempts (initial + retries)',
    ).toBeGreaterThanOrEqual(3)
  })

  it('should automatically retry failed messages', async () => {
    let processCount = 0

    const uniqueEventName = `retry.test.${Date.now()}`

    const retrySucceeded = new Promise<void>(resolve => {
      worker = queueCraft.createWorker(
        {
          queueName: `test-auto-retry-${Date.now()}`,
          handlers: {
            [uniqueEventName]: async (payload: RetryTestPayload, metadata: MessageMetadata) => {
              messageCount++
              processCount++

              const retryCount = (metadata.properties.headers?.['x-retry-count'] as number) || 0

              if (retryCount === 0) {
                throw new Error('Automatic retry test error')
              } else {
                resolve()
              }
            },
          },
          options: {
            queue: {
              durable: false,
              autoDelete: true,
            },
            retry: {
              maxRetries: 3,
              initialDelay: 100,
              backoffFactor: 1,
              maxDelay: 1000,
            },
          },
        },
        exchangeName,
      )
    })

    await assertWorker().start()

    await publisher.publish(uniqueEventName, { attemptCount: 0 })

    await Promise.race([
      retrySucceeded,
      createTimeout(5000, 'Timeout waiting for message retry to succeed'),
    ])

    expect(
      processCount,
      'Expected message to be processed at least twice (initial attempt + retry)',
    ).toBeGreaterThanOrEqual(2)
    expect(messageCount, 'Expected messageCount to be incremented').toBeGreaterThanOrEqual(2)
  })

  it('should support manual acknowledgment without returning early', async () => {
    let nackCalled = false
    let codeAfterManualAckExecuted = false

    const uniqueEventName = `manual-ack.test.${Date.now()}`

    const manualAckHandled = new Promise<void>(resolve => {
      worker = queueCraft.createWorker(
        {
          queueName: `test-manual-ack-${Date.now()}`,
          handlers: {
            [uniqueEventName]: async (payload: any, metadata: MessageMetadata) => {
              messageCount++

              if (payload.email === 'nack@example.com') {
                metadata.nack()
                nackCalled = true

                codeAfterManualAckExecuted = true
                resolve()
              }
            },
          },
          options: {
            queue: {
              durable: false,
              autoDelete: true,
            },

            retry: {
              maxRetries: 2,
              initialDelay: 100,
              backoffFactor: 1.5,
              maxDelay: 1000,
            },
          },
        },
        exchangeName,
      )
    })

    await assertWorker().start()

    await publisher.publish(uniqueEventName, {
      id: '123',
      name: 'Nack Test User',
      email: 'nack@example.com',
      operation: 'nack',
      createdAt: new Date().toISOString(),
    })

    await Promise.race([
      manualAckHandled,
      createTimeout(5000, 'Timeout waiting for manual ack test'),
    ])

    expect(nackCalled).toBe(true)
    expect(codeAfterManualAckExecuted).toBe(true)
    expect(messageCount, 'Expected messageCount to be incremented').toBeGreaterThanOrEqual(1)
  })
})
