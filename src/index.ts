/**
 * QueueCraft - A TypeScript-based Node.js framework for RabbitMQ event-driven communication
 */

export * from './types'
export { ConnectionManager } from './connection'
export { Publisher, createPublisher } from './publisher'
export { Worker, createWorker } from './worker'

import { ConnectionManager } from './connection'
import { Publisher, createPublisher } from './publisher'
import { Worker, createWorker } from './worker'
import {
  EventPayloadMap,
  PublisherOptions,
  QueueCraftConfig,
  WorkerConfig,
  Logger,
  QueueCraftConfigSchema,
  WorkerOptionsSchema,
  PublisherOptionsSchema,
} from './types'
import { ConsoleLogger } from './logger'
import { validateSchema } from './utils/validation'

/**
 * QueueCraft - Main class for managing RabbitMQ connections, publishers, and workers
 */
export class QueueCraft<T extends Record<string, any> = EventPayloadMap> {
  private static connectionManager: ConnectionManager
  private readonly publishers: Map<string, Publisher<T>> = new Map()
  private readonly workers: Map<string, Worker<T>> = new Map()
  private readonly logger: Logger

  /**
   * Creates a new QueueCraft instance
   * @param config QueueCraft configuration
   */
  constructor(config: QueueCraftConfig) {
    // Validate QueueCraft configuration
    validateSchema(
      QueueCraftConfigSchema,
      config,
      `Invalid QueueCraft configuration: ${JSON.stringify(config)}`,
    )

    this.logger = config.logger || new ConsoleLogger()

    if (!QueueCraft.connectionManager) {
      QueueCraft.connectionManager = new ConnectionManager(
        config.connection,
        config.defaultExchange,
        this.logger,
      )
    }

    this.logger.debug('QueueCraft instance created')
  }

  /**
   * Creates a new publisher
   * @param exchangeName Exchange name
   * @param options Publisher options
   * @returns Publisher instance
   */
  createPublisher(exchangeName = 'events', options: PublisherOptions = {}): Publisher<T> {
    // Validate publisher options
    validateSchema(
      PublisherOptionsSchema,
      options,
      `Invalid publisher options: ${JSON.stringify(options)}`,
    )

    const key = `publisher:${exchangeName}`

    if (!this.publishers.has(key)) {
      const publisher = createPublisher<T>(QueueCraft.connectionManager, exchangeName, options)

      this.publishers.set(key, publisher)
    }

    const publisher = this.publishers.get(key)
    if (!publisher) {
      this.logger.error(`Publisher not found for exchange: ${exchangeName}`)
      throw new Error(`Publisher not found for exchange: ${exchangeName}`)
    }

    this.logger.debug(`Publisher retrieved for exchange: ${exchangeName}`)
    return publisher
  }

  /**
   * Creates a new worker
   * @param config Worker configuration
   * @param exchangeName Exchange name
   * @returns Worker instance
   */
  createWorker(config: WorkerConfig<T>, exchangeName = 'events'): Worker<T> {
    // Validate worker config options if present
    if (config.options) {
      validateSchema(
        WorkerOptionsSchema,
        config.options,
        `Invalid worker options: ${JSON.stringify(config.options)}`,
      )
    }

    // Determine events to use for the key based on handlers
    let events: string[] = []

    if (config.handlers) {
      if (typeof config.handlers === 'object') {
        // Handlers is a direct event handler map
        events = Object.keys(config.handlers)
      }
    }

    const key = `worker:${exchangeName}:${events.join('.')}`

    if (!this.workers.has(key)) {
      const worker = createWorker<T>(QueueCraft.connectionManager, config, exchangeName)
      this.workers.set(key, worker)
    }

    const worker = this.workers.get(key)
    if (!worker) {
      this.logger.error(`Worker not found for events: ${events.join(', ')}`)
      throw new Error(`Worker not found for events: ${events.join(', ')}`)
    }

    this.logger.debug(`Worker retrieved for events: ${events.join(', ')}`)
    return worker
  }

  /**
   * Publishes an event
   * @param event Event name
   * @param payload Event payload
   * @param options Publish options
   * @param exchangeName Exchange name
   * @returns Promise that resolves when the event is published
   */
  async publishEvent<E extends keyof T>(
    event: E,
    payload: T[E],
    options: {
      headers?: Record<string, any>
      messageId?: string
      timestamp?: number
      contentType?: string
      contentEncoding?: string
      persistent?: boolean
    } = {},
    exchangeName = 'events',
  ): Promise<boolean> {
    const publisher = this.createPublisher(exchangeName)
    return publisher.publish(event, payload, options)
  }

  /**
   * Closes all connections, publishers, and workers
   * @returns Promise that resolves when all connections are closed
   */
  async close(): Promise<void> {
    this.logger.info('Closing QueueCraft instance')
    const closePromises: Promise<void>[] = []

    // Close all workers
    for (const worker of this.workers.values()) {
      closePromises.push(worker.stop())
    }

    // Wait for all workers to stop
    await Promise.all(closePromises)
    this.logger.debug('All workers stopped')

    // Close connection manager
    await QueueCraft.connectionManager.close()
    this.logger.debug('Connection manager closed')

    // Clear maps
    this.publishers.clear()
    this.workers.clear()

    this.logger.info('QueueCraft instance closed successfully')
  }
}

/**
 * Creates a new QueueCraft instance from environment variables
 * @returns QueueCraft instance
 */
export function createFromEnv<T extends EventPayloadMap = EventPayloadMap>(
  options: { logger?: Logger } = {},
): QueueCraft<T> {
  // Load environment variables
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('dotenv').config()
  } catch (error) {
    // Ignore if dotenv is not available
  }

  // Create logger if not provided
  const logger = options.logger || new ConsoleLogger()

  logger.debug('Creating QueueCraft instance from environment variables')

  const config: QueueCraftConfig = {
    connection: {
      host: process.env.RABBITMQ_HOST || 'localhost',
      port: parseInt(process.env.RABBITMQ_PORT || '5672'),
      username: process.env.RABBITMQ_USERNAME || 'guest',
      password: process.env.RABBITMQ_PASSWORD || 'guest',
      vhost: process.env.RABBITMQ_VHOST,
      timeout: process.env.RABBITMQ_TIMEOUT
        ? parseInt(process.env.RABBITMQ_TIMEOUT, 10)
        : undefined,
      heartbeat: process.env.RABBITMQ_HEARTBEAT
        ? parseInt(process.env.RABBITMQ_HEARTBEAT, 10)
        : undefined,
    },
    defaultExchange: {
      type: (process.env.RABBITMQ_EXCHANGE_TYPE || 'topic') as
        | 'direct'
        | 'topic'
        | 'fanout'
        | 'headers',
      durable: process.env.RABBITMQ_EXCHANGE_DURABLE !== 'false',
      autoDelete: process.env.RABBITMQ_EXCHANGE_AUTODELETE === 'true',
    },
    logger,
  }

  logger.debug('Configuration loaded from environment variables')
  return new QueueCraft<T>(config)
}
