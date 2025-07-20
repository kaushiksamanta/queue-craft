/**
 * Connection options for RabbitMQ
 */
export interface ConnectionOptions {
  /** RabbitMQ host */
  host: string
  /** RabbitMQ port */
  port: number
  /** RabbitMQ username */
  username: string
  /** RabbitMQ password */
  password: string
  /** RabbitMQ virtual host */
  vhost?: string
  /** Connection timeout in milliseconds */
  timeout?: number
  /** Heartbeat interval in seconds */
  heartbeat?: number
}

/**
 * Exchange options
 */
export interface ExchangeOptions {
  /** Exchange name */
  name: string
  /** Exchange type (default: 'topic') */
  type?: 'direct' | 'topic' | 'fanout' | 'headers'
  /** Whether the exchange should survive broker restarts (default: true) */
  durable?: boolean
  /** Whether the exchange should be deleted when the last queue is unbound from it (default: false) */
  autoDelete?: boolean
  /** Additional exchange arguments */
  arguments?: Record<string, any>
}

/**
 * Queue options
 */
export interface QueueOptions {
  /** Queue name */
  name: string
  /** Whether the queue should survive broker restarts (default: true) */
  durable?: boolean
  /** Whether the queue should be deleted when the last consumer unsubscribes (default: false) */
  autoDelete?: boolean
  /** Whether the queue should be used only by one connection (default: false) */
  exclusive?: boolean
  /** Additional queue arguments */
  arguments?: Record<string, any>
}

/**
 * Retry options for message processing
 */
export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries: number
  /** Initial delay in milliseconds before retrying */
  initialDelay: number
  /** Factor to multiply delay by for each subsequent retry */
  backoffFactor: number
  /** Maximum delay in milliseconds */
  maxDelay: number
}

/**
 * Error handling action to take after an error occurs
 */
export type ErrorAction = 'ack' | 'nack' | 'retry' | 'dead-letter'

/**
 * Worker configuration
 */
export interface WorkerConfig<T extends Record<string, any> = EventPayloadMap> {
  /**
   * Worker handlers - must be an object with event-specific handlers
   *
   * Note: Function handlers are no longer supported. Messages without handlers
   * will be sent to the dead letter queue.
   */
  handlers?: EventHandlerMap<T>
  /** Worker options */
  options?: {
    /** Number of messages to prefetch (default: 1) */
    prefetch?: number
    /** Queue options */
    queue?: Omit<QueueOptions, 'name'>
    /** Exchange options */
    exchange?: Omit<ExchangeOptions, 'name'>
    /** Retry options for failed message processing */
    retry?: RetryOptions
  }
}

/**
 * Publisher options
 */
export interface PublisherOptions {
  /** Exchange options */
  exchange?: Omit<ExchangeOptions, 'name'>
}

/**
 * Event payload map interface
 * This should be extended by users to define their own event types
 */
export interface EventPayloadMap {
  [eventName: string]: any
}

/**
 * Worker handler function type for a single event
 */
export type EventHandler<
  T extends Record<string, any> = EventPayloadMap,
  E extends keyof T = keyof T,
> = (payload: T[E], metadata: MessageMetadata) => Promise<void>

/**
 * Map of event handlers
 */
export type EventHandlerMap<T extends Record<string, any> = EventPayloadMap> = {
  [E in keyof T & string]?: EventHandler<T, E>
}

/**
 * Handler type - always an object with event handlers
 */
export type HandlerType<T extends Record<string, any> = EventPayloadMap> = EventHandlerMap<T>

/**
 * Message metadata
 */
export interface MessageMetadata {
  /** Message properties */
  properties: {
    /** Message ID */
    messageId?: string
    /** Timestamp */
    timestamp?: number
    /** Headers */
    headers?: Record<string, any>
    [key: string]: any
  }
  /** Message routing fields */
  fields?: {
    /** Routing key */
    routingKey: string
    /** Exchange */
    exchange: string
    [key: string]: any
  }
  /** Negative acknowledge function - rejects the message without requeuing */
  nack: () => void
  /** Requeue function - puts the message back in the queue */
  requeue: () => void
  /** Send message to dead letter queue */
  deadLetter?: () => Promise<void>
}

/**
 * QueueCraft configuration
 */
export interface QueueCraftConfig {
  /** Connection options */
  connection: ConnectionOptions
  /** Default exchange options */
  defaultExchange?: Omit<ExchangeOptions, 'name'>
  /** Logger instance */
  logger?: Logger
}

/**
 * Logger interface
 */
export interface Logger {
  /** Log a debug message */
  debug(message: string, ...meta: any[]): void
  /** Log an info message */
  info(message: string, ...meta: any[]): void
  /** Log a warning message */
  warn(message: string, ...meta: any[]): void
  /** Log an error message */
  error(message: string, ...meta: any[]): void
}
