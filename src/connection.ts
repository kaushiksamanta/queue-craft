import { Connection, Channel, connect, Replies } from 'amqplib';
import { ConnectionOptions, ExchangeOptions, QueueOptions } from './types';

/**
 * Connection manager for RabbitMQ
 */
export class ConnectionManager {
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private readonly options: ConnectionOptions;
  private readonly defaultExchangeOptions: Omit<ExchangeOptions, 'name'>;
  private connecting: Promise<void> | null = null;
  private setupExchanges: Set<string> = new Set();
  private setupQueues: Set<string> = new Set();

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
  ) {
    this.options = options;
    this.defaultExchangeOptions = defaultExchangeOptions;
  }

  /**
   * Gets the connection URL
   * @returns Connection URL
   */
  private getConnectionUrl(): string {
    const { host, port, username, password, vhost } = this.options;
    const encodedUsername = encodeURIComponent(username);
    const encodedPassword = encodeURIComponent(password);
    const encodedVhost = vhost ? encodeURIComponent(vhost) : '';

    return `amqp://${encodedUsername}:${encodedPassword}@${host}:${port}${
      encodedVhost ? '/' + encodedVhost : ''
    }`;
  }

  /**
   * Connects to RabbitMQ
   * @returns Promise that resolves when connected
   */
  async connect(): Promise<void> {
    if (this.connection && this.channel) {
      return;
    }

    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = (async () => {
      try {
        const url = this.getConnectionUrl();
        this.connection = await connect(url, {
          timeout: this.options.timeout,
          heartbeat: this.options.heartbeat,
        });

        if (this.connection) {
          this.connection.on('error', err => {
            console.error('RabbitMQ connection error:', err);
            this.handleConnectionError();
          });

          this.connection.on('close', () => {
            console.warn('RabbitMQ connection closed');
            this.handleConnectionError();
          });

          this.channel = await this.connection.createChannel();
          console.log('Connected to RabbitMQ');
        }
      } catch (error) {
        console.error('Failed to connect to RabbitMQ:', error);
        this.connection = null;
        this.channel = null;
        throw error;
      } finally {
        this.connecting = null;
      }
    })();

    return this.connecting;
  }

  /**
   * Handles connection errors
   */
  private handleConnectionError(): void {
    this.connection = null;
    this.channel = null;
    this.setupExchanges.clear();
    this.setupQueues.clear();
  }

  /**
   * Gets the channel
   * @returns Channel
   * @throws Error if not connected
   */
  async getChannel(): Promise<Channel> {
    if (!this.channel) {
      await this.connect();
    }

    if (!this.channel) {
      throw new Error('Not connected to RabbitMQ');
    }

    return this.channel;
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
    const channel = await this.getChannel();

    // Skip if already set up
    if (this.setupExchanges.has(name)) {
      return { exchange: name };
    }

    const { type = 'topic', durable = true, autoDelete = false, arguments: args } = options;

    const result = await channel.assertExchange(name, type, {
      durable,
      autoDelete,
      arguments: args,
    });

    this.setupExchanges.add(name);
    return result;
  }

  /**
   * Asserts a queue
   * @param name Queue name
   * @param options Queue options
   * @returns Promise that resolves when the queue is asserted
   */
  async assertQueue(name: string, options: Omit<QueueOptions, 'name'> = {}): Promise<Replies.AssertQueue> {
    const channel = await this.getChannel();

    // Skip if already set up
    if (this.setupQueues.has(name)) {
      return { queue: name, messageCount: 0, consumerCount: 0 };
    }

    const { durable = true, autoDelete = false, exclusive = false, arguments: args } = options;

    const result = await channel.assertQueue(name, {
      durable,
      autoDelete,
      exclusive,
      arguments: args,
    });

    this.setupQueues.add(name);
    return result;
  }

  /**
   * Binds a queue to an exchange
   * @param queue Queue name
   * @param exchange Exchange name
   * @param pattern Routing pattern
   * @returns Promise that resolves when the binding is created
   */
  async bindQueue(queue: string, exchange: string, pattern: string): Promise<Replies.Empty> {
    const channel = await this.getChannel();
    return channel.bindQueue(queue, exchange, pattern);
  }

  /**
   * Sets the prefetch count for the channel
   * @param count Prefetch count
   * @returns Promise that resolves when the prefetch count is set
   */
  async setPrefetch(count: number): Promise<void> {
    const channel = await this.getChannel();
    await channel.prefetch(count);
  }

  /**
   * Closes the connection
   * @returns Promise that resolves when the connection is closed
   */
  async close(): Promise<void> {
    if (this.channel) {
      await this.channel.close();
      this.channel = null;
    }

    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }

    this.setupExchanges.clear();
    this.setupQueues.clear();
  }
}
