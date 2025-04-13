import { vi } from 'vitest';
import {
  EventPayloadMap,
} from '../../src/types';
import { Worker } from '../../src/worker';
import { Channel, ConsumeMessage } from 'amqplib';

// Define user created payload interface
export interface UserCreatedPayload {
  id: string;
  name: string;
}

// Define order placed payload interface
export interface OrderPlacedPayload {
  orderId: string;
  userId: string;
  amount: number;
}

// Define error test payload interface
export interface ErrorTestPayload {
  shouldFail: boolean;
}

// Define retry test payload interface
export interface RetryTestPayload {
  attemptCount: number;
}

// Define type-safe payload map for our tests
export interface TestEventPayloadMap extends EventPayloadMap {
  'user.created': UserCreatedPayload;
  'order.placed': OrderPlacedPayload;
  'error.test': ErrorTestPayload;
  'retry.test': RetryTestPayload;
}

// Mock message type for testing
export interface TestMessage {
  content: Buffer;
  fields: {
    routingKey: string;
    exchange?: string;
    consumerTag?: string;
    deliveryTag?: number;
    redelivered?: boolean;
  };
  properties: {
    headers?: Record<string, unknown>;
    messageId?: string;
    timestamp?: number;
  };
}

// Define the Worker private methods we need to spy on
export interface WorkerPrivateMethods {
  requeueWithRetryCount(msg: ConsumeMessage, payload: unknown, routingKey: string, retryCount: number): Promise<void>;
  sendToDeadLetterQueue(msg: ConsumeMessage, payload: unknown, routingKey: string, error?: Error): Promise<void>;
}

// Define worker type to help with type checking
export type TestWorker =
  | Worker<TestEventPayloadMap>
  | Worker<Pick<TestEventPayloadMap, 'user.created'>>
  | Worker<Pick<TestEventPayloadMap, 'error.test'>>
  | Worker<Pick<TestEventPayloadMap, 'retry.test'>>
  | Worker<Pick<TestEventPayloadMap, 'user.created' | 'order.placed'>>;


// Define the mock channel type
export  type MockChannel = Partial<Channel> & {
  assertExchange: ReturnType<typeof vi.fn>;
  assertQueue: ReturnType<typeof vi.fn>;
  bindQueue: ReturnType<typeof vi.fn>;
  prefetch: ReturnType<typeof vi.fn>;
  consume: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  ack: ReturnType<typeof vi.fn>;
  nack: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

  // Define the mock connection manager type
export interface MockConnectionManager {
    connect: ReturnType<typeof vi.fn>;
    getChannel: ReturnType<typeof vi.fn>;
    assertExchange: ReturnType<typeof vi.fn>;
    assertQueue: ReturnType<typeof vi.fn>;
    bindQueue: ReturnType<typeof vi.fn>;
    setPrefetch: ReturnType<typeof vi.fn>;
    closeConnection: ReturnType<typeof vi.fn>;
    consumeCallback: ((msg: ConsumeMessage | null) => Promise<void>) | null;
  }