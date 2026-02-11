import { describe, it, expect, afterEach, vi } from 'vitest'
import { QueueCraft } from '../../src/index'
import { Logger } from '../../src/types'

interface TestEventPayloadMap {
  'user.created': { id: string; name: string }
}

const silentLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

describe('QueueCraft', () => {
  const instances: QueueCraft<TestEventPayloadMap>[] = []

  afterEach(async () => {
    while (instances.length > 0) {
      const instance = instances.pop()
      if (instance) {
        await instance.close()
      }
    }
  })

  it('should cache workers separately when queue names differ', () => {
    const queueCraft = new QueueCraft<TestEventPayloadMap>({
      connection: {
        host: 'localhost',
        port: 5672,
        username: 'guest',
        password: 'guest',
      },
      logger: silentLogger,
    })
    instances.push(queueCraft)

    const handlers = {
      'user.created': async (_payload: { id: string; name: string }) => {
        return
      },
    }

    const firstWorker = queueCraft.createWorker({ queueName: 'queue-a', handlers }, 'events')
    const secondWorker = queueCraft.createWorker({ queueName: 'queue-b', handlers }, 'events')

    expect(secondWorker).not.toBe(firstWorker)
  })

  it('should reuse workers when queue name and handlers are the same', () => {
    const queueCraft = new QueueCraft<TestEventPayloadMap>({
      connection: {
        host: 'localhost',
        port: 5672,
        username: 'guest',
        password: 'guest',
      },
      logger: silentLogger,
    })
    instances.push(queueCraft)

    const handlers = {
      'user.created': async (_payload: { id: string; name: string }) => {
        return
      },
    }

    const firstWorker = queueCraft.createWorker({ queueName: 'queue-a', handlers }, 'events')
    const secondWorker = queueCraft.createWorker({ queueName: 'queue-a', handlers }, 'events')

    expect(secondWorker).toBe(firstWorker)
  })
})
