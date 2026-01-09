import { Connection, Channel, ConfirmChannel, connect, Replies } from 'amqplib'
import { EventEmitter } from 'events'
import {
  ConnectionOptions,
  ExchangeOptions,
  QueueOptions,
  Logger,
  ConnectionOptionsSchema,
  ExchangeOptionsSchema,
  QueueOptionsSchema,
} from './types'
import { ConsoleLogger } from './logger'
import { validateSchema } from './utils/validation'

/**
 * Reconnection options for automatic connection recovery
 */
export interface ReconnectionOptions {
  /** Whether to automatically reconnect on connection loss (default: true) */
  autoReconnect?: boolean
  /** Maximum number of reconnection attempts (default: 10) */
  maxAttempts?: number
  /** Initial delay in milliseconds before first reconnection attempt (default: 1000) */
  initialDelay?: number
  /** Maximum delay in milliseconds between reconnection attempts (default: 30000) */
  maxDelay?: number
  /** Backoff factor for exponential delay (default: 2) */
  backoffFactor?: number
}

const DEFAULT_RECONNECTION_OPTIONS: Required<ReconnectionOptions> = {
  autoReconnect: true,
  maxAttempts: 10,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
}

/**
 * Connection status for health checks
 */
export interface ConnectionStatus {
  connected: boolean
  reconnecting: boolean
  reconnectAttempts: number
  lastError?: Error
  lastConnectedAt?: Date
  lastDisconnectedAt?: Date
}

/**
 * Connection manager for RabbitMQ
 * Extends EventEmitter to emit connection events:
 * - 'connected': Emitted when connection is established
 * - 'disconnected': Emitted when connection is lost
 * - 'reconnecting': Emitted when attempting to reconnect (with attempt number)
 * - 'reconnected': Emitted when reconnection succeeds
 * - 'reconnectFailed': Emitted when all reconnection attempts fail
 * - 'error': Emitted on connection errors
 */
export class ConnectionManager extends EventEmitter {
  private connection: Connection | null = null
  private channel: Channel | null = null
  private confirmChannel: ConfirmChannel | null = null
  private readonly options: ConnectionOptions
  private readonly defaultExchangeOptions: Omit<ExchangeOptions, 'name'>
  private connecting: Promise<void> | null = null
  private setupExchanges: Set<string> = new Set()
  private setupQueues: Set<string> = new Set()
  private readonly logger: Logger
  private readonly reconnectionOptions: Required<ReconnectionOptions>
  private reconnectAttempts = 0
  private isReconnecting = false
  private lastError?: Error
  private lastConnectedAt?: Date
  private lastDisconnectedAt?: Date
  private reconnectTimer?: NodeJS.Timeout

  /**
   * Creates a new ConnectionManager instance
   * @param options Connection options
   * @param defaultExchangeOptions Default exchange options
   */
  constructor(
    options: ConnectionOptions,
    defaultExchangeOptions: Omit<ExchangeOptions, 'name'> = {
      type: 'topic',
      durable: true,
      autoDelete: false,
    },
    logger?: Logger,
    reconnectionOptions?: ReconnectionOptions,
  ) {
    super()

    // Validate connection options at runtime using TypeBox
    validateSchema(
      ConnectionOptionsSchema,
      options,
      `Invalid connection options: ${JSON.stringify(options)}`,
    )

    this.options = options
    this.defaultExchangeOptions = defaultExchangeOptions
    this.logger = logger || new ConsoleLogger()
    this.reconnectionOptions = {
      ...DEFAULT_RECONNECTION_OPTIONS,
      ...reconnectionOptions,
    }
  }

  /**
   * Gets the connection URL
   * @returns Connection URL
   */
  private getConnectionUrl(): string {
    const { host, port, username, password, vhost } = this.options
    const encodedUsername = encodeURIComponent(username)
    const encodedPassword = encodeURIComponent(password)
    const encodedVhost = vhost ? encodeURIComponent(vhost) : ''

    return `amqp://${encodedUsername}:${encodedPassword}@${host}:${port}${
      encodedVhost ? '/' + encodedVhost : ''
    }`
  }

  /**
   * Connects to RabbitMQ
   * @returns Promise that resolves when connected
   */
  async connect(): Promise<void> {
    if (this.connection && this.channel) {
      return
    }

    if (this.connecting) {
      return this.connecting
    }

    this.connecting = (async () => {
      try {
        const url = this.getConnectionUrl()
        this.connection = await connect(url, {
          timeout: this.options.timeout,
          heartbeat: this.options.heartbeat,
        })

        if (this.connection) {
          this.connection.on('error', err => {
            this.logger.error('RabbitMQ connection error:', err)
            this.emit('error', err)
            this.handleConnectionError(err)
          })

          this.connection.on('close', () => {
            this.logger.warn('RabbitMQ connection closed')
            this.handleConnectionError()
          })

          this.channel = await this.connection.createChannel()
          this.lastConnectedAt = new Date()
          this.logger.info('Connected to RabbitMQ')
          this.emit('connected', { timestamp: this.lastConnectedAt })
        }
      } catch (error) {
        this.logger.error('Failed to connect to RabbitMQ:', error)
        this.connection = null
        this.channel = null
        throw error
      } finally {
        this.connecting = null
      }
    })()

    return this.connecting
  }

  /**
   * Handles connection errors and initiates reconnection if enabled
   */
  private handleConnectionError(error?: Error): void {
    this.connection = null
    this.channel = null
    this.confirmChannel = null
    this.setupExchanges.clear()
    this.setupQueues.clear()
    this.lastDisconnectedAt = new Date()

    if (error) {
      this.lastError = error
    }

    this.emit('disconnected', { error, timestamp: this.lastDisconnectedAt })

    if (this.reconnectionOptions.autoReconnect && !this.isReconnecting) {
      this.reconnectWithBackoff()
    }
  }

  /**
   * Attempts to reconnect with exponential backoff
   */
  private async reconnectWithBackoff(): Promise<void> {
    if (this.isReconnecting) {
      return
    }

    this.isReconnecting = true
    this.reconnectAttempts = 0

    const { maxAttempts, initialDelay, maxDelay, backoffFactor } = this.reconnectionOptions

    while (this.reconnectAttempts < maxAttempts) {
      this.reconnectAttempts++
      const delay = Math.min(
        initialDelay * Math.pow(backoffFactor, this.reconnectAttempts - 1),
        maxDelay,
      )

      this.logger.info(
        `Attempting to reconnect to RabbitMQ (attempt ${this.reconnectAttempts}/${maxAttempts}) in ${delay}ms`,
      )
      this.emit('reconnecting', { attempt: this.reconnectAttempts, maxAttempts, delay })

      await this.sleep(delay)

      try {
        await this.connect()
        this.isReconnecting = false
        this.reconnectAttempts = 0
        this.logger.info('Successfully reconnected to RabbitMQ')
        this.emit('reconnected', { attempts: this.reconnectAttempts })
        return
      } catch (error) {
        this.lastError = error instanceof Error ? error : new Error(String(error))
        this.logger.warn(
          `Reconnection attempt ${this.reconnectAttempts} failed: ${this.lastError.message}`,
        )
      }
    }

    this.isReconnecting = false
    this.logger.error(`Failed to reconnect after ${maxAttempts} attempts`)
    this.emit('reconnectFailed', { attempts: this.reconnectAttempts, lastError: this.lastError })
  }

  /**
   * Sleep utility for reconnection delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      this.reconnectTimer = setTimeout(resolve, ms)
    })
  }

  /**
   * Gets the channel
   * @returns Channel
   * @throws Error if not connected
   */
  async getChannel(): Promise<Channel> {
    if (!this.channel) {
      await this.connect()
    }

    if (!this.channel) {
      throw new Error('Not connected to RabbitMQ')
    }

    return this.channel
  }

  /**
   * Asserts an exchange
   * @param name Exchange name
   * @param options Exchange options
   * @returns Promise that resolves when the exchange is asserted
   */
  async assertExchange(
    name: string,
    options: Omit<ExchangeOptions, 'name'> = this.defaultExchangeOptions,
  ): Promise<Replies.AssertExchange> {
    const channel = await this.getChannel()

    // Skip if already set up
    if (this.setupExchanges.has(name)) {
      return { exchange: name }
    }

    // Validate exchange options with name added
    const fullOptions = { name, ...options }
    validateSchema(
      ExchangeOptionsSchema,
      fullOptions,
      `Invalid exchange options: ${JSON.stringify(fullOptions)}`,
    )

    const { type = 'topic', durable = true, autoDelete = false, arguments: args } = options

    const result = await channel.assertExchange(name, type, {
      durable,
      autoDelete,
      arguments: args,
    })

    this.setupExchanges.add(name)
    return result
  }

  /**
   * Asserts a queue
   * @param name Queue name
   * @param options Queue options
   * @returns Promise that resolves when the queue is asserted
   */
  async assertQueue(
    name: string,
    options: Omit<QueueOptions, 'name'> = {},
  ): Promise<Replies.AssertQueue> {
    const channel = await this.getChannel()

    // Skip if already set up
    if (this.setupQueues.has(name)) {
      return { queue: name, messageCount: 0, consumerCount: 0 }
    }

    // Validate queue options with name added
    const fullOptions = { name, ...options }
    validateSchema(
      QueueOptionsSchema,
      fullOptions,
      `Invalid queue options: ${JSON.stringify(fullOptions)}`,
    )

    const { durable = true, autoDelete = false, exclusive = false, arguments: args } = options

    const result = await channel.assertQueue(name, {
      durable,
      autoDelete,
      exclusive,
      arguments: args,
    })

    this.setupQueues.add(name)
    return result
  }

  /**
   * Binds a queue to an exchange
   * @param queue Queue name
   * @param exchange Exchange name
   * @param pattern Routing pattern
   * @returns Promise that resolves when the binding is created
   */
  async bindQueue(queue: string, exchange: string, pattern: string): Promise<Replies.Empty> {
    const channel = await this.getChannel()
    return channel.bindQueue(queue, exchange, pattern)
  }

  /**
   * Sets the prefetch count for the channel
   * @param count Prefetch count
   * @returns Promise that resolves when the prefetch count is set
   */
  async setPrefetch(count: number): Promise<void> {
    const channel = await this.getChannel()
    await channel.prefetch(count)
  }

  /**
   * Gets a confirm channel for publisher confirms
   * @returns ConfirmChannel
   * @throws Error if not connected
   */
  async getConfirmChannel(): Promise<ConfirmChannel> {
    if (!this.confirmChannel) {
      if (!this.connection) {
        await this.connect()
      }

      if (!this.connection) {
        throw new Error('Not connected to RabbitMQ')
      }

      this.confirmChannel = await this.connection.createConfirmChannel()
    }

    return this.confirmChannel
  }

  /**
   * Gets the current connection status for health checks
   * @returns ConnectionStatus object
   */
  getStatus(): ConnectionStatus {
    return {
      connected: this.connection !== null && this.channel !== null,
      reconnecting: this.isReconnecting,
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
    }
  }

  /**
   * Checks if the connection is healthy
   * @returns true if connected and channel is available
   */
  isHealthy(): boolean {
    return this.connection !== null && this.channel !== null
  }

  /**
   * Closes the connection
   * @returns Promise that resolves when the connection is closed
   */
  async close(): Promise<void> {
    // Clear any pending reconnection timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }

    // Disable auto-reconnect during close
    this.isReconnecting = false

    if (this.confirmChannel) {
      try {
        await this.confirmChannel.close()
      } catch (error) {
        this.logger.warn('Error closing confirm channel:', error)
      }
      this.confirmChannel = null
    }

    if (this.channel) {
      try {
        await this.channel.close()
      } catch (error) {
        this.logger.warn('Error closing channel:', error)
      }
      this.channel = null
    }

    if (this.connection) {
      try {
        await this.connection.close()
      } catch (error) {
        this.logger.warn('Error closing connection:', error)
      }
      this.connection = null
    }

    this.setupExchanges.clear()
    this.setupQueues.clear()
  }
}
