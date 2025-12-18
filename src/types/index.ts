import { Type, Static } from '@sinclair/typebox'

/**
 * Connection options for RabbitMQ
 */
export const ConnectionOptionsSchema = Type.Object({
  /** RabbitMQ host */
  host: Type.String(),
  /** RabbitMQ port */
  port: Type.Number(),
  /** RabbitMQ username */
  username: Type.String(),
  /** RabbitMQ password */
  password: Type.String(),
  /** RabbitMQ virtual host */
  vhost: Type.Optional(Type.String()),
  /** Connection timeout in milliseconds */
  timeout: Type.Optional(Type.Number()),
  /** Heartbeat interval in seconds */
  heartbeat: Type.Optional(Type.Number()),
})

export type ConnectionOptions = Static<typeof ConnectionOptionsSchema>

/**
 * Exchange options
 */
export const ExchangeOptionsSchema = Type.Object({
  /** Exchange name */
  name: Type.String(),
  /** Exchange type (default: 'topic') */
  type: Type.Optional(
    Type.Union([
      Type.Literal('direct'),
      Type.Literal('topic'),
      Type.Literal('fanout'),
      Type.Literal('headers'),
    ]),
  ),
  /** Whether the exchange should survive broker restarts (default: true) */
  durable: Type.Optional(Type.Boolean()),
  /** Whether the exchange should be deleted when the last queue is unbound from it (default: false) */
  autoDelete: Type.Optional(Type.Boolean()),
  /** Additional exchange arguments */
  arguments: Type.Optional(Type.Record(Type.String(), Type.Any())),
})

export type ExchangeOptions = Static<typeof ExchangeOptionsSchema>

/**
 * Queue options
 */
export const QueueOptionsSchema = Type.Object({
  /** Queue name */
  name: Type.String(),
  /** Whether the queue should survive broker restarts (default: true) */
  durable: Type.Optional(Type.Boolean()),
  /** Whether the queue should be deleted when the last consumer unsubscribes (default: false) */
  autoDelete: Type.Optional(Type.Boolean()),
  /** Whether the queue should be used only by one connection (default: false) */
  exclusive: Type.Optional(Type.Boolean()),
  /** Additional queue arguments */
  arguments: Type.Optional(Type.Record(Type.String(), Type.Any())),
})

export type QueueOptions = Static<typeof QueueOptionsSchema>

/**
 * Retry options for message processing
 */
export const RetryOptionsSchema = Type.Object({
  /** Maximum number of retry attempts */
  maxRetries: Type.Number(),
  /** Initial delay in milliseconds before retrying */
  initialDelay: Type.Number(),
  /** Factor to multiply delay by for each subsequent retry */
  backoffFactor: Type.Number(),
  /** Maximum delay in milliseconds */
  maxDelay: Type.Number(),
})

export type RetryOptions = Static<typeof RetryOptionsSchema>

/**
 * Error handling action to take after an error occurs
 */
export const ErrorActionSchema = Type.Union([
  Type.Literal('ack'),
  Type.Literal('nack'),
  Type.Literal('retry'),
  Type.Literal('dead-letter'),
])

export type ErrorAction = Static<typeof ErrorActionSchema>

/**
 * Worker configuration
 */
export const WorkerOptionsSchema = Type.Object({
  /** Number of messages to prefetch (default: 1) */
  prefetch: Type.Optional(Type.Number()),
  /** Queue options */
  queue: Type.Optional(Type.Omit(QueueOptionsSchema, ['name'])),
  /** Exchange options */
  exchange: Type.Optional(Type.Omit(ExchangeOptionsSchema, ['name'])),
  /** Retry options for failed message processing */
  retry: Type.Optional(RetryOptionsSchema),
})

// Note: EventHandlerMap contains functions which can't be validated with TypeBox at runtime
export interface WorkerConfig<T extends Record<string, any> = EventPayloadMap> {
  /**
   * Worker handlers - must be an object with event-specific handlers
   *
   * Note: Function handlers are no longer supported. Messages without handlers
   * will be sent to the dead letter queue.
   */
  handlers?: EventHandlerMap<T>
  /**
   * Queue name for this worker. This is required and should be a stable name
   * that doesn't change when handlers are added or removed.
   * Example: 'user-service' or 'order-worker'
   */
  queueName: string
  /** Worker options */
  options?: Static<typeof WorkerOptionsSchema>
}

/**
 * Publisher options
 */
export const PublisherOptionsSchema = Type.Object({
  /** Exchange options */
  exchange: Type.Optional(Type.Omit(ExchangeOptionsSchema, ['name'])),
})

export type PublisherOptions = Static<typeof PublisherOptionsSchema>

/**
 * Event payload map interface
 * This should be extended by users to define their own event types
 */
export const EventPayloadMapSchema = Type.Record(Type.String(), Type.Any())

export type EventPayloadMap = Static<typeof EventPayloadMapSchema>

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
export const MessagePropertiesSchema = Type.Object({
  /** Message ID */
  messageId: Type.Optional(Type.String()),
  /** Timestamp */
  timestamp: Type.Optional(Type.Number()),
  /** Headers */
  headers: Type.Optional(Type.Record(Type.String(), Type.Any())),
})

export const MessageFieldsSchema = Type.Object({
  /** Routing key */
  routingKey: Type.String(),
  /** Exchange */
  exchange: Type.String(),
})

// Note: Functions can't be validated with TypeBox at runtime, so we keep them as TypeScript types
export interface MessageMetadata {
  /** Message properties */
  properties: Static<typeof MessagePropertiesSchema> & Record<string, any>
  /** Message routing fields */
  fields?: Static<typeof MessageFieldsSchema> & Record<string, any>
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
export const QueueCraftConfigSchema = Type.Object({
  /** Connection options */
  connection: ConnectionOptionsSchema,
  /** Default exchange options */
  defaultExchange: Type.Optional(Type.Omit(ExchangeOptionsSchema, ['name'])),
  /** Logger instance - can't be validated with TypeBox */
  logger: Type.Optional(Type.Any()),
})

export type QueueCraftConfig = Static<typeof QueueCraftConfigSchema> & {
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
