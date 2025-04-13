import { ConnectionManager } from './connection';
import { EventPayloadMap, PublisherOptions } from './types';

/**
 * Publisher class for publishing events to RabbitMQ
 */
export class Publisher<T extends EventPayloadMap = EventPayloadMap> {
  private connectionManager: ConnectionManager;
  private exchangeName: string;
  private options: PublisherOptions;

  /**
   * Creates a new Publisher instance
   * @param connectionManager Connection manager
   * @param exchangeName Exchange name
   * @param options Publisher options
   */
  constructor(
    connectionManager: ConnectionManager,
    exchangeName = 'events',
    options: PublisherOptions = {},
  ) {
    this.connectionManager = connectionManager;
    this.exchangeName = exchangeName;
    this.options = options;
  }

  /**
   * Initializes the publisher
   * @returns Promise that resolves when the publisher is initialized
   */
  private async initialize(): Promise<void> {
    await this.connectionManager.connect();
    await this.connectionManager.assertExchange(this.exchangeName, this.options.exchange);
  }

  /**
   * Publishes an event
   * @param event Event name
   * @param payload Event payload
   * @param options Publish options
   * @returns Promise that resolves when the event is published
   */
  async publish<E extends keyof T>(
    event: E,
    payload: T[E],
    options: {
      headers?: Record<string, any>;
      messageId?: string;
      timestamp?: number;
      contentType?: string;
      contentEncoding?: string;
      persistent?: boolean;
    } = {},
  ): Promise<boolean> {
    await this.initialize();

    const channel = await this.connectionManager.getChannel();
    const eventName = String(event);
    const content = Buffer.from(JSON.stringify(payload));

    const {
      headers,
      messageId,
      timestamp = Date.now(),
      contentType = 'application/json',
      contentEncoding = 'utf-8',
      persistent = true,
    } = options;

    return channel.publish(this.exchangeName, eventName, content, {
      contentType,
      contentEncoding,
      headers,
      messageId,
      timestamp,
      persistent,
    });
  }

  /**
   * Closes the publisher
   * @returns Promise that resolves when the publisher is closed
   */
  async close(): Promise<void> {
    await this.connectionManager.close();
  }
}

/**
 * Creates a new publisher
 * @param connectionManager Connection manager
 * @param exchangeName Exchange name
 * @param options Publisher options
 * @returns Publisher instance
 */
export function createPublisher<T extends EventPayloadMap = EventPayloadMap>(
  connectionManager: ConnectionManager,
  exchangeName = 'events',
  options: PublisherOptions = {},
): Publisher<T> {
  return new Publisher<T>(connectionManager, exchangeName, options);
}
