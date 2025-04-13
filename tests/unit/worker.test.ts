import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import { ConnectionManager } from '../../src/connection';
import { Worker } from '../../src/worker';
import { WorkerConfig, MessageMetadata } from '../../src/types';
import { ConsumeMessage } from 'amqplib';

// Mock ConnectionManager
vi.mock('../../src/connection', () => {
  // Create mock functions with proper typings
  const mockConsume = vi.fn().mockResolvedValue({ consumerTag: 'test-consumer' });
  const mockCancel = vi.fn().mockResolvedValue({});
  const mockAck = vi.fn();
  const mockNack = vi.fn();
  const mockPublish = vi.fn().mockResolvedValue({});
  const mockSendToQueue = vi.fn().mockResolvedValue({});

  const mockChannel = {
    consume: mockConsume,
    cancel: mockCancel,
    ack: mockAck,
    nack: mockNack,
    publish: mockPublish,
    sendToQueue: mockSendToQueue,
    assertExchange: vi.fn().mockResolvedValue({}),
    assertQueue: vi.fn().mockResolvedValue({ queue: 'test-queue' }),
    bindQueue: vi.fn().mockResolvedValue({}),
    prefetch: vi.fn().mockResolvedValue({}),
  };

  const MockConnectionManager = vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    getChannel: vi.fn().mockResolvedValue(mockChannel),
    assertExchange: vi
      .fn()
      .mockImplementation((name, options) => mockChannel.assertExchange(name, options)),
    assertQueue: vi
      .fn()
      .mockImplementation((name, options) => mockChannel.assertQueue(name, options)),
    bindQueue: vi
      .fn()
      .mockImplementation((queue, exchange, pattern) =>
        mockChannel.bindQueue(queue, exchange, pattern),
      ),
    setPrefetch: vi.fn().mockImplementation(count => mockChannel.prefetch(count)),
    close: vi.fn().mockResolvedValue(undefined),
  }));

  return {
    ConnectionManager: MockConnectionManager,
  };
});

describe('Worker', () => {
  // Define test event payload map
  interface TestEventPayloadMap {
    'user.created': { id: string; name: string };
    'user.updated': { id: string; name: string };
  }

  let connectionManager: ConnectionManager;
  let worker: Worker<TestEventPayloadMap>;
  let handler: ReturnType<typeof vi.fn>;

  // Define test message type
  interface TestMessage {
    content: Buffer;
    fields: {
      routingKey: string;
      exchange?: string;
      deliveryTag?: number;
      redelivered?: boolean;
      consumerTag?: string;
    };
    properties: {
      headers?: Record<string, unknown>;
      messageId?: string;
      timestamp?: number;
    };
  }

  // Define the Worker private methods we need to spy on
  interface WorkerPrivateMethods {
    requeueWithRetryCount(msg: ConsumeMessage, payload: unknown, routingKey: string, retryCount: number): Promise<void>;
    sendToDeadLetterQueue(msg: ConsumeMessage, payload: unknown, routingKey: string, error?: Error): Promise<void>;
    processMessageWithRetry(event: string, payload: unknown, metadata: MessageMetadata, msg: ConsumeMessage): Promise<void>;
  }

  let specificHandlers: {
    'user.created': ReturnType<
      typeof vi.fn<[payload: { id: string; name: string }, metadata: import('../../src/types').MessageMetadata], Promise<void>>
    >;
    'user.updated': ReturnType<
      typeof vi.fn<[payload: { id: string; name: string }, metadata: import('../../src/types').MessageMetadata], Promise<void>>
    >;
  };
  let workerConfig: WorkerConfig<TestEventPayloadMap>;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create dependencies
    connectionManager = new ConnectionManager({
      host: 'localhost',
      port: 5672,
      username: 'guest',
      password: 'guest',
      vhost: '/',
    });

    handler = vi.fn().mockResolvedValue(undefined);
    specificHandlers = {
      'user.created': vi
        .fn<[payload: { id: string; name: string }, metadata: import('../../src/types').MessageMetadata], Promise<void>>()
        .mockResolvedValue(undefined),
      'user.updated': vi
        .fn<[payload: { id: string; name: string }, metadata: import('../../src/types').MessageMetadata], Promise<void>>()
        .mockResolvedValue(undefined),
    };

    workerConfig = {
      handlers: specificHandlers,
      options: {
        prefetch: 10,
        // autoAck is now always true by default
      },
    };

    worker = new Worker(connectionManager, workerConfig, 'test-exchange');
  });

  afterEach(async () => {
    await worker.close();
  });

  it('should initialize worker', async () => {
    await worker.initialize();

    expect(connectionManager.connect).toHaveBeenCalled();
    expect(connectionManager.setPrefetch).toHaveBeenCalledWith(10);
    expect(connectionManager.assertExchange).toHaveBeenCalledWith('test-exchange', undefined);
    expect(connectionManager.assertQueue).toHaveBeenCalled();
    expect(connectionManager.bindQueue).toHaveBeenCalledTimes(2);
  });

  it('should start consuming', async () => {
    await worker.start();

    const channel = await connectionManager.getChannel();

    // Check that channel.consume was called with the queue name and a callback function
    // The exact parameters may vary in implementation, so we'll just verify it was called
    expect(channel.consume).toHaveBeenCalled();
    // Use type assertion to access mock property with proper typing
    const consumeMock = channel.consume as unknown as { mock: { calls: Array<[string, (msg: TestMessage) => Promise<void>, object]> } };
    expect(consumeMock.mock.calls[0][0]).toBe('queue.user.created.user.updated');
    expect(typeof consumeMock.mock.calls[0][1]).toBe('function');
  });

  it('should stop consuming', async () => {
    await worker.start();
    await worker.stop();

    const channel = await connectionManager.getChannel();

    expect(channel.cancel).toHaveBeenCalledWith('test-consumer');
  });

  it('should handle message', async () => {
    await worker.start();

    const channel = await connectionManager.getChannel();
    const consumeFn = channel.consume as unknown as { mock: { calls: Array<[string, (msg: TestMessage) => Promise<void>, { noAck: boolean }]> } };
    const consumeCallback = consumeFn.mock.calls[0][1];

    const message: TestMessage = {
      content: Buffer.from(JSON.stringify({ id: '123', name: 'John' })),
      fields: { routingKey: 'user.created' },
      properties: {
        messageId: 'msg-123',
        timestamp: Date.now(),
        headers: { source: 'test' },
      },
    };

    await consumeCallback(message);

    expect(specificHandlers['user.created']).toHaveBeenCalledWith(
      { id: '123', name: 'John' },
      expect.objectContaining({
        properties: expect.objectContaining({
          messageId: 'msg-123',
        }),
        nack: expect.any(Function),
        requeue: expect.any(Function),
        deadLetter: expect.any(Function),
      }),
    );
  });

  it('should handle message with automatic acknowledgment', async () => {
    worker = new Worker(connectionManager, workerConfig, 'test-exchange');

    await worker.start();

    const channel = await connectionManager.getChannel();
    const consumeFn = channel.consume as unknown as { mock: { calls: Array<[string, (msg: TestMessage) => Promise<void>, { noAck: boolean }]> } };
    const consumeCallback = consumeFn.mock.calls[0][1];

    const message: TestMessage = {
      content: Buffer.from(JSON.stringify({ id: '123', name: 'John' })),
      fields: { routingKey: 'user.created' },
      properties: {},
    };

    await consumeCallback(message);

    // Check if the event-specific handler was called
    expect(specificHandlers['user.created']).toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('should handle error in message processing', async () => {
    // Setup error handlers
    handler.mockRejectedValue(new Error('Test error'));
    specificHandlers['user.created'] = vi.fn().mockRejectedValue(new Error('Test error'));

    // Configure worker with custom retry options for testing
    workerConfig.options = {
      ...workerConfig.options,
      retry: {
        maxRetries: 2,
        initialDelay: 10,
        backoffFactor: 1.5,
        maxDelay: 100,
      },
      // Disable delay queue for simpler testing
      enableDelayQueue: false,
    };
    worker = new Worker(connectionManager, workerConfig, 'test-exchange');

    // Mock the channel.ack method to verify it's called
    const ackSpy = vi.fn();
    const channel = await connectionManager.getChannel();
    channel.ack = ackSpy;
    
    // Create a spy for requeueWithRetryCount method with proper typing
    const requeueSpy = vi.spyOn(worker as unknown as WorkerPrivateMethods, 'requeueWithRetryCount');
    requeueSpy.mockImplementation(() => Promise.resolve());

    await worker.start();

    // Use type assertion to access mock property with proper typing
    const consumeFn = channel.consume as unknown as { mock: { calls: Array<[string, (msg: TestMessage) => Promise<void>, { noAck: boolean }]> } };
    const consumeCallback = consumeFn.mock.calls[0][1];

    const message: TestMessage = {
      content: Buffer.from(JSON.stringify({ id: '123', name: 'John' })),
      fields: { routingKey: 'user.created' },
      properties: {
        headers: {},
      },
    };

    // Execute the consume callback - this should not throw since errors are handled internally
    await consumeCallback(message);

    // Check if the event-specific handler was called
    expect(specificHandlers['user.created']).toHaveBeenCalled();

    // Verify that requeueWithRetryCount was called for retry logic
    expect(requeueSpy).toHaveBeenCalled();
    
    // Verify that the message was acknowledged after being requeued
    expect(ackSpy).toHaveBeenCalledWith(message);
    
    // Restore mocks
    requeueSpy.mockRestore();
  });
});
