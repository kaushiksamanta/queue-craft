/**
 * QueueCraft - A TypeScript-based Node.js framework for RabbitMQ event-driven communication
 */

export * from './types'
export { ConnectionManager, ReconnectionOptions, ConnectionStatus } from './connection'
export { Publisher, createPublisher } from './publisher'
export { Worker, createWorker } from './worker'

import { ConnectionManager, ReconnectionOptions, ConnectionStatus } from './connection'
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
 * Graceful shutdown options
 */
export interface GracefulShutdownOptions {
  /** Timeout in milliseconds to wait for graceful shutdown (default: 30000) */
  timeout?: number
  /** Signals to listen for (default: ['SIGTERM', 'SIGINT']) */
  signals?: NodeJS.Signals[]
  /** Callback to run before shutdown starts */
  beforeShutdown?: () => Promise<void> | void
  /** Callback to run after shutdown completes */
  afterShutdown?: () => Promise<void> | void
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  healthy: boolean
  connection: ConnectionStatus
  publishers: number
  workers: number
  timestamp: Date
}

/**
 * QueueCraft - Main class for managing RabbitMQ connections, publishers, and workers
 */
export class QueueCraft<T extends Record<string, any> = EventPayloadMap> {
  private readonly connectionManager: ConnectionManager
  private readonly publishers: Map<string, Publisher<T>> = new Map()
  private readonly workers: Map<string, Worker<T>> = new Map()
  private readonly logger: Logger
  private shutdownInProgress = false
  private shutdownHandlersRegistered = false
  private boundShutdownHandler?: () => Promise<void>
  private registeredSignals: NodeJS.Signals[] = []
  private isClosed = false

  /**
   * Creates a new QueueCraft instance
   * @param config QueueCraft configuration
   */
  constructor(config: QueueCraftConfig & { reconnection?: ReconnectionOptions }) {
    validateSchema(
      QueueCraftConfigSchema,
      config,
      `Invalid QueueCraft configuration: ${JSON.stringify(config)}`,
    )

    this.logger = config.logger || new ConsoleLogger()

    this.connectionManager = new ConnectionManager(
      config.connection,
      config.defaultExchange,
      this.logger,
      config.reconnection,
    )

    this.logger.debug('QueueCraft instance created')
  }

  /**
   * Creates a new publisher
   * @param exchangeName Exchange name
   * @param options Publisher options
   * @returns Publisher instance
   */
  createPublisher(exchangeName = 'events', options: PublisherOptions = {}): Publisher<T> {
    if (this.isClosed) {
      throw new Error('QueueCraft instance has been closed')
    }

    validateSchema(
      PublisherOptionsSchema,
      options,
      `Invalid publisher options: ${JSON.stringify(options)}`,
    )

    const key = `publisher:${exchangeName}`

    if (!this.publishers.has(key)) {
      const publisher = createPublisher<T>(this.connectionManager, exchangeName, options)

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
    if (this.isClosed) {
      throw new Error('QueueCraft instance has been closed')
    }

    if (config.options) {
      validateSchema(
        WorkerOptionsSchema,
        config.options,
        `Invalid worker options: ${JSON.stringify(config.options)}`,
      )
    }

    let events: string[] = []

    if (config.handlers) {
      if (typeof config.handlers === 'object') {
        events = Object.keys(config.handlers)
      }
    }

    const key = `worker:${exchangeName}:${config.queueName}:${events.join('.')}`

    if (!this.workers.has(key)) {
      const worker = createWorker<T>(this.connectionManager, config, exchangeName)
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
   * Publishes an event with broker confirmation
   * @param event Event name
   * @param payload Event payload
   * @param options Publish options including timeout
   * @param exchangeName Exchange name
   * @returns Promise that resolves when the broker confirms receipt
   */
  async publishEventWithConfirm<E extends keyof T>(
    event: E,
    payload: T[E],
    options: {
      headers?: Record<string, any>
      messageId?: string
      timestamp?: number
      contentType?: string
      contentEncoding?: string
      persistent?: boolean
      timeout?: number
    } = {},
    exchangeName = 'events',
  ): Promise<void> {
    const publisher = this.createPublisher(exchangeName)
    return publisher.publishWithConfirm(event, payload, options)
  }

  /**
   * Gets the health status of the QueueCraft instance
   * @returns HealthCheckResult with connection and component status
   */
  getHealth(): HealthCheckResult {
    const connectionStatus = this.connectionManager.getStatus()
    return {
      healthy: connectionStatus.connected && !this.shutdownInProgress,
      connection: connectionStatus,
      publishers: this.publishers.size,
      workers: this.workers.size,
      timestamp: new Date(),
    }
  }

  /**
   * Checks if the QueueCraft instance is healthy
   * @returns true if connected and not shutting down
   */
  isHealthy(): boolean {
    return this.connectionManager.isHealthy() && !this.shutdownInProgress
  }

  /**
   * Gets the underlying connection manager for advanced use cases
   * @returns ConnectionManager instance
   */
  getConnectionManager(): ConnectionManager {
    return this.connectionManager
  }

  /**
   * Enables graceful shutdown handling for SIGTERM and SIGINT signals
   * @param options Graceful shutdown options
   */
  enableGracefulShutdown(options: GracefulShutdownOptions = {}): void {
    if (this.shutdownHandlersRegistered) {
      this.logger.warn('Graceful shutdown handlers already registered')
      return
    }

    const {
      timeout = 30000,
      signals = ['SIGTERM', 'SIGINT'],
      beforeShutdown,
      afterShutdown,
    } = options

    this.boundShutdownHandler = async () => {
      if (this.shutdownInProgress) {
        this.logger.warn('Shutdown already in progress')
        return
      }

      this.shutdownInProgress = true
      this.logger.info('Graceful shutdown initiated')

      let timeoutId: NodeJS.Timeout | undefined

      try {
        if (beforeShutdown) {
          await beforeShutdown()
        }

        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Graceful shutdown timed out after ${timeout}ms`))
          }, timeout)
        })

        await Promise.race([this.close(), timeoutPromise])

        if (timeoutId) {
          clearTimeout(timeoutId)
        }

        this.logger.info('Graceful shutdown completed successfully')

        if (afterShutdown) {
          await afterShutdown()
        }

        process.exit(0)
      } catch (error) {
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        this.logger.error('Error during graceful shutdown:', error)
        process.exit(1)
      }
    }

    for (const signal of signals) {
      process.on(signal, this.boundShutdownHandler)
    }

    this.registeredSignals = signals
    this.shutdownHandlersRegistered = true
    this.logger.info(`Graceful shutdown handlers registered for signals: ${signals.join(', ')}`)
  }

  /**
   * Disables graceful shutdown handling
   */
  disableGracefulShutdown(): void {
    if (!this.shutdownHandlersRegistered || !this.boundShutdownHandler) {
      return
    }

    for (const signal of this.registeredSignals) {
      process.removeListener(signal, this.boundShutdownHandler)
    }

    this.shutdownHandlersRegistered = false
    this.boundShutdownHandler = undefined
    this.registeredSignals = []
    this.logger.info('Graceful shutdown handlers removed')
  }

  /**
   * Closes all connections, publishers, and workers
   * @returns Promise that resolves when all connections are closed
   */
  async close(): Promise<void> {
    this.logger.info('Closing QueueCraft instance')
    const closePromises: Promise<void>[] = []

    for (const worker of this.workers.values()) {
      closePromises.push(worker.stop())
    }

    await Promise.all(closePromises)
    this.logger.debug('All workers stopped')

    await this.connectionManager.close()
    this.logger.debug('Connection manager closed')

    this.publishers.clear()
    this.workers.clear()

    this.isClosed = true

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
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('dotenv').config()
  } catch {}

  const logger = options.logger || new ConsoleLogger()

  logger.debug('Creating QueueCraft instance from environment variables')

  const parseIntSafe = (value: string | undefined, defaultValue: number): number => {
    if (!value) return defaultValue
    const parsed = parseInt(value, 10)
    return isNaN(parsed) ? defaultValue : parsed
  }

  const config: QueueCraftConfig = {
    connection: {
      host: process.env.RABBITMQ_HOST || 'localhost',
      port: parseIntSafe(process.env.RABBITMQ_PORT, 5672),
      username: process.env.RABBITMQ_USERNAME || 'guest',
      password: process.env.RABBITMQ_PASSWORD || 'guest',
      vhost: process.env.RABBITMQ_VHOST,
      timeout: process.env.RABBITMQ_TIMEOUT
        ? parseIntSafe(process.env.RABBITMQ_TIMEOUT, 30000)
        : undefined,
      heartbeat: process.env.RABBITMQ_HEARTBEAT
        ? parseIntSafe(process.env.RABBITMQ_HEARTBEAT, 60)
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
