import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Worker } from '../../src/worker';
import { ConnectionManager } from '../../src/connection';
import {
  MessageMetadata,
  WorkerConfig,
} from '../../src/types';
import { ConsumeMessage } from 'amqplib';
import { ErrorTestPayload, MockChannel, MockConnectionManager, OrderPlacedPayload, RetryTestPayload, TestEventPayloadMap, TestMessage, TestWorker, UserCreatedPayload, WorkerPrivateMethods } from './types';

describe('Integration: Publisher and Worker', () => {
  // Mock connection manager
  const connectionManager: MockConnectionManager = {
    connect: vi.fn().mockResolvedValue(undefined),
    getChannel: vi.fn().mockResolvedValue({
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: 'test-queue' }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockImplementation((queue, callback) => {
        // Store the callback for later use in tests
        connectionManager.consumeCallback = callback;
        return Promise.resolve({ consumerTag: 'test-consumer' });
      }),
      publish: vi.fn().mockResolvedValue(true),
      ack: vi.fn(),
      nack: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as MockChannel),
    assertExchange: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn().mockResolvedValue({ queue: 'test-queue' }),
    bindQueue: vi.fn().mockResolvedValue(undefined),
    setPrefetch: vi.fn().mockResolvedValue(undefined),
    closeConnection: vi.fn().mockResolvedValue(undefined),
    consumeCallback: null,
  };

  // Define the mock QueueCraft type
  interface MockQueueCraft {
    publishEvent: <E extends keyof TestEventPayloadMap>(event: E, payload: TestEventPayloadMap[E]) => Promise<void>;
    createWorker: <T extends Partial<TestEventPayloadMap>>(config: WorkerConfig<T>) => Worker<T>;
  }
  
  // Mock QueueCraft to use our mock connection manager
  const queueCraft: MockQueueCraft = {
    publishEvent: vi.fn().mockImplementation((event, payload) => {
      // Simulate publishing an event by directly calling the consume callback
      if (connectionManager.consumeCallback) {
        const message: TestMessage = {
          content: Buffer.from(JSON.stringify(payload)),
          fields: { routingKey: event as string },
          properties: {
            headers: {},
          },
        };
        
        // Call the consume callback with the message
        connectionManager.consumeCallback(message as unknown as ConsumeMessage);
      }
      return Promise.resolve();
    }),
    createWorker: vi.fn().mockImplementation(<T extends Partial<TestEventPayloadMap>>(config: WorkerConfig<T>) => {
      // Create a worker with our mock connection manager
      return new Worker(connectionManager as unknown as ConnectionManager, config, 'test-exchange');
    }),
  };

  let worker: TestWorker;
  let messageCount = 0;
  let errorCount = 0;

  beforeEach(async () => {
    // Reset counters and mocks
    messageCount = 0;
    errorCount = 0;
    vi.clearAllMocks();
  });

  // Clean up after each test
  afterEach(async () => {
    // Stop the worker if it exists
    if (worker) {
      await worker.stop();
    }
  });

  it('should publish and consume messages', async () => {
    // Create a spy to track message handling
    const handlerSpy = vi.fn<[UserCreatedPayload, MessageMetadata], Promise<void>>();

    // Create a worker with a handler for the user.created event
    worker = queueCraft.createWorker({
      handlers: {
        'user.created': async (payload: UserCreatedPayload, metadata: MessageMetadata) => {
          messageCount++;
          handlerSpy(payload, metadata);
        },
      },
      options: {
        queue: {
          durable: false,
          autoDelete: true,
        },
      },
    });

    // Start the worker
    await worker.start();

    // Publish an event
    await queueCraft.publishEvent('user.created', { id: '123', name: 'Test User' });

    // Verify message was processed
    expect(messageCount).toBe(1);
    expect(handlerSpy).toHaveBeenCalledWith(
      { id: '123', name: 'Test User' },
      expect.objectContaining({
        properties: expect.objectContaining({
          headers: expect.any(Object),
        }),
      }),
    );
  });

  it('should handle multiple event types', async () => {
    // Create spies to track message handling
    const userHandlerSpy = vi.fn<[UserCreatedPayload, MessageMetadata], Promise<void>>();
    const orderHandlerSpy = vi.fn<[OrderPlacedPayload, MessageMetadata], Promise<void>>();

    // Create a worker with handlers for multiple events
    worker = queueCraft.createWorker({
      handlers: {
        'user.created': async (payload: UserCreatedPayload, metadata: MessageMetadata) => {
          messageCount++;
          userHandlerSpy(payload, metadata);
        },
        'order.placed': async (payload: OrderPlacedPayload, metadata: MessageMetadata) => {
          messageCount++;
          orderHandlerSpy(payload, metadata);
        },
      },
      options: {
        queue: {
          durable: false,
          autoDelete: true,
        },
      },
    });

    // Start the worker
    await worker.start();

    // Publish events
    await queueCraft.publishEvent('user.created', { id: '123', name: 'Test User' });
    await queueCraft.publishEvent('order.placed', { orderId: '456', userId: '123', amount: 99.99 });

    // Verify messages were processed
    expect(messageCount).toBe(2);
    expect(userHandlerSpy).toHaveBeenCalledWith(
      { id: '123', name: 'Test User' },
      expect.any(Object),
    );
    expect(orderHandlerSpy).toHaveBeenCalledWith(
      { orderId: '456', userId: '123', amount: 99.99 },
      expect.any(Object),
    );
  });

  it('should handle errors with automatic retry', async () => {
    // Create a counter for tracking retry attempts
    errorCount = 0;

    // Create a worker with a handler that throws an error
    worker = queueCraft.createWorker({
      handlers: {
        'error.test': async (payload: ErrorTestPayload, _metadata: MessageMetadata) => {
          if (payload.shouldFail) {
            errorCount++;
            throw new Error('Test error');
          }
        },
      },
      options: {
        // Auto-acknowledgment is always enabled by default
        // Error handling now uses automatic retry mechanism
        queue: {
          durable: false,
          autoDelete: true,
        },
        retry: {
          maxRetries: 2,
          initialDelay: 100,
          backoffFactor: 1,
          maxDelay: 1000
        }
      },
    });

    // Start the worker
    await worker.start();

    // Publish an event that will cause an error
    await queueCraft.publishEvent('error.test', { shouldFail: true });

    // Wait for the error to be processed and retried
    let attempts = 0;
    while (errorCount < 1 && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    // Verify error was handled
    expect(errorCount).toBeGreaterThan(0);
  });

  it('should automatically retry failed messages', async () => {
    // Create a counter to track retry attempts
    let processCount = 0;
    
    // Create a spy for the requeueWithRetryCount method with proper typing
    const requeueSpy = vi.spyOn(Worker.prototype as unknown as WorkerPrivateMethods, 'requeueWithRetryCount');
    requeueSpy.mockImplementation((msg, payload, routingKey, retryCount) => {
      // Simulate a retry by calling the consume callback again with updated headers
      if (connectionManager.consumeCallback) {
        const message: TestMessage = {
          content: Buffer.from(JSON.stringify(payload)),
          fields: { routingKey },
          properties: {
            headers: { 'x-retry-count': retryCount },
          },
        };
        
        // Call the consume callback with the message
        connectionManager.consumeCallback(message as unknown as ConsumeMessage);
      }
      return Promise.resolve();
    });

    // Create a worker with a handler that throws an error on first attempt
    worker = queueCraft.createWorker({
      handlers: {
        'retry.test': async (payload: RetryTestPayload, metadata: MessageMetadata) => {
          processCount++;
          
          // Get retry count from headers
          const retryCount = metadata.properties.headers?.['x-retry-count'] as number || 0;
          
          // Succeed on the second attempt
          if (retryCount === 0) {
            throw new Error('Automatic retry test error');
          }
          // Otherwise succeed
        },
      },
      options: {
        // Auto-acknowledgment is always enabled by default
        queue: {
          durable: false,
          autoDelete: true,
        },
        retry: {
          maxRetries: 3,
          initialDelay: 100,
          backoffFactor: 1,
          maxDelay: 1000
        },
        enableDelayQueue: true,
      },
    });

    // Start the worker
    await worker.start();

    // Publish an event that will succeed on retry
    await queueCraft.publishEvent('retry.test', { attemptCount: 0 });

    // Verify message was processed multiple times
    expect(processCount).toBe(2);
    expect(requeueSpy).toHaveBeenCalled();
    
    // Restore the spy
    requeueSpy.mockRestore();
  });
});
