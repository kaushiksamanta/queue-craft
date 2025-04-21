import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { QueueCraft } from '../../src/index';
import { MessageMetadata } from '../../src/types';
import { ErrorTestPayload, OrderPlacedPayload, RetryTestPayload, TestEventPayloadMap, TestWorker, UserCreatedPayload } from './types';

/**
 * Integration tests for QueueCraft Publisher and Worker
 * 
 * These tests verify the integration between Publisher and Worker components
 * with a real RabbitMQ connection. Each test creates a unique exchange and
 * tests a specific functionality of the system.
 */
describe('Integration: Publisher and Worker', () => {
  // Use a unique exchange name with timestamp to avoid conflicts with other processes
  // This ensures test isolation even if previous tests failed to clean up properly
  const exchangeName = `test-exchange-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  
  // Use consistent exchange options across all tests
  const exchangeOptions = {
    type: 'topic' as const, // Type assertion to make TypeScript happy
    durable: false,
    autoDelete: false, // Changed to false to prevent exchange from being deleted between tests
  };

  // Create a real QueueCraft instance for integration testing
  // Each QueueCraft instance is type-safe for a single payload map.
  // To use a different event map, create a new QueueCraft instance.
  // All instances share the same RabbitMQ connection by default.
  const queueCraft = new QueueCraft<TestEventPayloadMap>({
    connection: {
      host: process.env.RABBITMQ_HOST || 'localhost',
      port: parseInt(process.env.RABBITMQ_PORT || '5672', 10),
      username: process.env.RABBITMQ_USERNAME || 'guest',
      password: process.env.RABBITMQ_PASSWORD || 'guest',
      vhost: process.env.RABBITMQ_VHOST || '/',
      // Add timeout to avoid hanging tests
      timeout: 2000,
      // Add heartbeat to keep connection alive
      heartbeat: 5,
    },
  });

  // Create a publisher for testing with the custom exchange name
  const publisher = queueCraft.createPublisher(exchangeName, {
    exchange: exchangeOptions
  });
  
  let worker: TestWorker | undefined;
  let messageCount = 0;
  let errorCount = 0;

  beforeEach(async () => {
    // Reset counters
    messageCount = 0;
    errorCount = 0;
  });

  // Clean up after each test
  afterEach(async () => {
    // Clean up the worker after each test
    if (worker) {
      try {
        await worker.stop();
      } catch (error) {
        console.log('Error stopping worker:', error instanceof Error ? error.message : String(error));
      }
      worker = undefined;
    }
  });

  // Clean up after all tests
  afterAll(async () => {
    try {
      // Close the connection
      await queueCraft.close();
      console.log('RabbitMQ connection closed successfully');
    } catch (error) {
      console.error('Error closing RabbitMQ connection:', error instanceof Error ? error.message : String(error));
    }
  }, 5000); // Give 5 seconds to clean up connections

  // In each test, we verify that the message is processed by waiting for this promise
  let messageProcessed: Promise<void>;

  /**
   * Helper function to ensure worker is defined
   * This prevents TypeScript errors and provides clear error messages
   * if worker is undefined due to initialization failure
   */
  const assertWorker = (): TestWorker => {
    if (!worker) {
      throw new Error('Worker is undefined - worker initialization may have failed');
    }
    return worker;
  };
  
  /**
   * Helper function to create a timeout promise
   * @param ms Timeout in milliseconds
   * @param errorMessage Custom error message
   */
  const createTimeout = (ms: number, errorMessage: string) => {
    return new Promise<void>((_, reject) => 
      setTimeout(() => reject(new Error(`${errorMessage} (waited ${ms}ms)`)), ms)
    );
  };
  
  it('should publish and consume messages', async () => {
    // Create a Promise that will resolve when the message is processed
    // This allows us to wait for asynchronous message processing
    messageProcessed = new Promise<void>((resolve) => {
      // Create a worker with a handler for the user.created event
      worker = queueCraft.createWorker({
        handlers: {
          'user.created': async (payload: UserCreatedPayload, metadata: MessageMetadata) => {
            messageCount++;
            
            // Verify payload data
            expect(payload.id).toBe('123');
            expect(payload.name).toBe('Test User');
            
            // Verify metadata
            expect(metadata.properties).toBeDefined();
            expect(metadata.properties.headers).toBeDefined();
            
            // Resolve the promise to signal message was processed
            resolve();
          },
        },
        options: {
          queue: {
            durable: false,
            autoDelete: true,
          },
        },
      }, exchangeName);
    });

    // Start the worker (start() will call initialize() internally)
    await assertWorker().start();

    // Publish an event
    await publisher.publish('user.created', { 
      id: '123', 
      name: 'Test User',
      email: 'test@example.com',
      createdAt: new Date().toISOString()
    });

    // Wait for the message to be processed with a timeout
    await Promise.race([
      messageProcessed,
      createTimeout(10000, 'Timeout waiting for user.created message to be processed')
    ]);

    // Verify message was processed
    expect(messageCount, 'Expected exactly one message to be processed').toBe(1);
    

  });

  it('should handle multiple event types', async () => {
    // Create promises that will resolve when messages are processed
    const userMessageProcessed = new Promise<void>((resolve) => {
      // Create a worker with handlers for multiple event types
      worker = queueCraft.createWorker({
        handlers: {
          'user.created': async (payload: UserCreatedPayload, metadata: MessageMetadata) => {
            messageCount++;
            
            // Verify payload data
            expect(payload.id).toBe('123');
            expect(payload.name).toBe('Test User');
            
            // Resolve the promise to signal message was processed
            resolve();
          },
          'order.placed': async (payload: OrderPlacedPayload, metadata: MessageMetadata) => {
            messageCount++;
            
            // Verify payload data
            expect(payload.id).toBe('456');
            expect(payload.userId).toBe('123');
            expect(payload.total).toBe(99.99);
          },
        },
        options: {
          queue: {
            durable: false,
            autoDelete: true,
          },
        },
      }, exchangeName);
    });

    // Start the worker (start() will call initialize() internally)
    await assertWorker().start();

    // Publish events
    await publisher.publish('user.created', { 
      id: '123', 
      name: 'Test User',
      email: 'test@example.com',
      createdAt: new Date().toISOString()
    });
    await publisher.publish('order.placed', { 
      id: '456', 
      userId: '123', 
      items: [{ productId: 'prod-1', quantity: 1, price: 99.99 }],
      total: 99.99, 
      placedAt: new Date().toISOString() 
    });

    // Wait for the user message to be processed with a timeout
    await Promise.race([
      userMessageProcessed,
      createTimeout(5000, 'Timeout waiting for user.created message in multiple event test')
    ]);

    // Wait a bit for the order message to be processed
    // This ensures the second message has time to be processed
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  it('should handle errors and retry messages', async () => {
    // Create a Promise that will resolve when the error is handled
    const errorHandled = new Promise<void>((resolve) => {
      // Create a worker with a handler that throws an error
      worker = queueCraft.createWorker({
        handlers: {
          'error.test': async (payload: ErrorTestPayload, _metadata: MessageMetadata) => {
            if (payload.shouldFail) {
              errorCount++;
              
              // If this is the third attempt (retry count = 2), resolve the promise
              if (errorCount >= 3) {
                resolve();
              }
              
              throw new Error('Test error');
            }
          },
        },
        options: {
          queue: {
            durable: false,
            autoDelete: true,
          },
          retry: {
            maxRetries: 3,
            initialDelay: 100,
            backoffFactor: 1,
            maxDelay: 1000
          }
        },
      }, exchangeName);
    });

    // Start the worker (start() will call initialize() internally)
    await assertWorker().start();

    // Publish an event that will cause an error
    await publisher.publish('error.test', { shouldFail: true });

    // Wait for the error to be handled with retries (with a timeout)
    // This allows enough time for multiple retry attempts
    await Promise.race([
      errorHandled,
      createTimeout(5000, 'Timeout waiting for error retry handling')
    ]);

    // Verify error was handled multiple times (initial + retries)
    expect(errorCount, 'Expected at least 3 error processing attempts (initial + retries)').toBeGreaterThanOrEqual(3);
  });

  it('should automatically retry failed messages', async () => {
    let processCount = 0;
    
    // Use unique event name to avoid conflicts with existing queues
    const uniqueEventName = `retry.test.${Date.now()}`;
    
    // Create a Promise that will resolve when the message is processed successfully after retry
    const retrySucceeded = new Promise<void>((resolve) => {
      // Create a worker with a handler that throws an error on first attempt
      worker = queueCraft.createWorker({
        handlers: {
          [uniqueEventName]: async (payload: RetryTestPayload, metadata: MessageMetadata) => {
            processCount++;
            
            // Get retry count from headers
            const retryCount = metadata.properties.headers?.['x-retry-count'] as number || 0;
            
            // Succeed on the second attempt
            if (retryCount === 0) {
              throw new Error('Automatic retry test error');
            } else {
              // This is a retry attempt, so resolve the promise
              resolve();
            }
          },
        },
        options: {
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
        },
      }, exchangeName);
    });

    // Start the worker (start() will call initialize() internally)
    await assertWorker().start();

    // Publish an event that will succeed on retry
    await publisher.publish(uniqueEventName, { attemptCount: 0 });

    // Wait for the message to be processed successfully after retry (with a timeout)
    await Promise.race([
      retrySucceeded,
      createTimeout(5000, 'Timeout waiting for message retry to succeed')
    ]);

    // Verify message was processed multiple times
    expect(processCount, 'Expected message to be processed at least twice (initial attempt + retry)').toBeGreaterThanOrEqual(2);
  });

  it('should support manual acknowledgment without returning early', async () => {
    // Create flags to track what happened during message processing
    let nackCalled = false;
    let requeueCalled = false;
    let deadLetterCalled = false;
    let codeAfterManualAckExecuted = false;

    // Create a unique event name for this test to avoid conflicts with other tests
    const uniqueEventName = `manual-ack.test.${Date.now()}`;
    
    // Create a Promise that will resolve when the message is processed
    const manualAckHandled = new Promise<void>((resolve) => {
      // Create a worker with handlers that use manual acknowledgment
      worker = queueCraft.createWorker({
        handlers: {
          // Use the unique event name - this will determine the queue name
          [uniqueEventName]: async (payload: any, metadata: MessageMetadata) => {
            // Call different manual acknowledgment methods based on the user email
            if (payload.email === 'nack@example.com') {
              // Use nack without return
              metadata.nack();
              nackCalled = true;
              
              // This code should still execute (with the fixed implementation)
              codeAfterManualAckExecuted = true;
              resolve();
            }
            else if (payload.email === 'requeue@example.com') {
              // Use requeue without return
              metadata.requeue();
              requeueCalled = true;
              
              // This code should still execute (with the fixed implementation)
              codeAfterManualAckExecuted = true;
              resolve();
            }
            else if (payload.email === 'deadletter@example.com' && metadata.deadLetter) {
              // Use deadLetter without return
              await metadata.deadLetter();
              deadLetterCalled = true;
              
              // This code should still execute (with the fixed implementation)
              codeAfterManualAckExecuted = true;
              resolve();
            }
          }
        },
        options: {
          queue: {
            durable: false,
            autoDelete: true
          },
          // Use shorter timeouts for testing
          retry: {
            maxRetries: 2,
            initialDelay: 100,
            backoffFactor: 1.5,
            maxDelay: 1000
          }
        }
      }, exchangeName);
    });

    // Start the worker
    await assertWorker().start();

    // Try nack with our unique event name
    await publisher.publish(uniqueEventName, {
      id: '123',
      name: 'Nack Test User',
      email: 'nack@example.com',
      operation: 'nack',
      createdAt: new Date().toISOString()
    });

    // Wait for the message to be processed with a timeout
    await Promise.race([
      manualAckHandled,
      createTimeout(5000, 'Timeout waiting for manual ack test')
    ]);

    // Verify that code continued executing after nack
    expect(nackCalled).toBe(true);
    expect(codeAfterManualAckExecuted).toBe(true);
  });
});
