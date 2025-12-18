# QueueCraft Usage Guide

Complete API reference and usage examples for QueueCraft.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Publisher API](#publisher-api)
- [Worker API](#worker-api)
- [Error Handling](#error-handling)
- [Advanced Usage](#advanced-usage)

---

## Installation

```bash
npm install queue-craft
```

---

## Quick Start

### 1. Define Event Types

```typescript
// types.ts
import { EventPayloadMap } from 'queue-craft';

export interface MyEvents extends EventPayloadMap {
  'user.created': { id: string; name: string; email: string };
  'user.updated': { id: string; changes: Record<string, any> };
  'order.placed': { orderId: string; userId: string; amount: number };
}
```

### 2. Create a Publisher

```typescript
// publisher.ts
import { QueueCraft } from 'queue-craft';
import { MyEvents } from './types';

const queueCraft = new QueueCraft<MyEvents>({
  connection: {
    host: 'localhost',
    port: 5672,
    username: 'guest',
    password: 'guest',
  },
});

const publisher = queueCraft.createPublisher('events');

// Publish events (type-safe)
await publisher.publish('user.created', {
  id: '123',
  name: 'John Doe',
  email: 'john@example.com',
});

await queueCraft.close();
```

### 3. Create a Worker

```typescript
// worker.ts
import { QueueCraft } from 'queue-craft';
import { MyEvents } from './types';

const queueCraft = new QueueCraft<MyEvents>({
  connection: {
    host: 'localhost',
    port: 5672,
    username: 'guest',
    password: 'guest',
  },
});

const worker = queueCraft.createWorker({
  queueName: 'user-service',  // Required: explicit queue name
  handlers: {
    'user.created': async (payload, metadata) => {
      console.log(`User created: ${payload.name}`);
      // Process the event...
    },
    'user.updated': async (payload, metadata) => {
      console.log(`User ${payload.id} updated`);
    },
  },
});

await worker.start();

// Graceful shutdown
process.on('SIGINT', async () => {
  await worker.close();
  process.exit(0);
});
```

---

## Configuration

### QueueCraft Options

```typescript
const queueCraft = new QueueCraft<MyEvents>({
  connection: {
    host: 'localhost',       // RabbitMQ host
    port: 5672,              // RabbitMQ port
    username: 'guest',       // Username
    password: 'guest',       // Password
    vhost: '/',              // Virtual host (optional)
    timeout: 30000,          // Connection timeout ms (optional)
    heartbeat: 60,           // Heartbeat interval sec (optional)
  },
  defaultExchange: {         // Optional
    type: 'topic',
    durable: true,
    autoDelete: false,
  },
});
```

### Worker Options

```typescript
const worker = queueCraft.createWorker({
  queueName: 'user-service',  // Required: stable queue name

  handlers: {
    'event.name': async (payload, metadata) => { /* ... */ },
  },

  options: {
    prefetch: 10,              // Messages to prefetch (default: 1)
    queue: {
      durable: true,           // Survive broker restart
      exclusive: false,        // Single consumer only
      autoDelete: false,       // Delete when unused
    },
    exchange: {
      type: 'topic',           // Exchange type
      durable: true,
    },
    retry: {
      maxRetries: 3,           // Max retry attempts
      initialDelay: 100,       // Initial delay (ms)
      backoffFactor: 2,        // Exponential multiplier
      maxDelay: 5000,          // Max delay (ms)
    },
  },
});
```

---

## Publisher API

### Creating a Publisher

```typescript
const publisher = queueCraft.createPublisher('exchange-name', {
  exchange: {
    type: 'topic',    // 'direct' | 'topic' | 'fanout' | 'headers'
    durable: true,
  },
});
```

### Publishing Events

```typescript
// Basic publish
await publisher.publish('user.created', { id: '123', name: 'John' });

// With options
await publisher.publish('user.created', payload, {
  messageId: 'unique-id',
  timestamp: Date.now(),
  headers: {
    'x-trace-id': 'abc123',
  },
});
```

### Closing Publisher

```typescript
await publisher.close();
```

---

## Worker API

### Creating a Worker

```typescript
const worker = queueCraft.createWorker({
  queueName: 'my-queue',
  handlers: {
    'event.name': async (payload, metadata) => {
      // Handle event
    },
  },
});
```

### Starting/Stopping

```typescript
await worker.start();   // Start consuming
await worker.stop();    // Stop consuming (keeps connection)
await worker.close();   // Stop and close connection
```

### Dynamic Handler Registration

```typescript
// Add handler at runtime
await worker.addHandler('user.deleted', async (payload, metadata) => {
  console.log(`User ${payload.id} deleted`);
});

// Remove handler (messages will go to DLQ)
worker.removeHandler('user.deleted');
```

### Getting Queue Name

```typescript
const queueName = worker.getQueueName();
console.log(`Consuming from: ${queueName}`);
```

### Message Metadata

Handlers receive `metadata` with control methods:

```typescript
handlers: {
  'user.created': async (payload, metadata) => {
    // Access message properties
    const { messageId, timestamp, headers } = metadata.properties;
    const { routingKey, exchange } = metadata.fields;

    // Control methods
    metadata.nack();           // Reject, don't requeue
    metadata.requeue();        // Put back in queue
    await metadata.deadLetter(); // Send to DLQ
  },
}
```

---

## Error Handling

### Automatic Retry

Errors thrown in handlers trigger automatic retry:

```typescript
handlers: {
  'order.process': async (payload) => {
    const result = await processOrder(payload);
    if (!result.success) {
      throw new Error('Processing failed'); // Will retry
    }
  },
}
```

### Manual Control

```typescript
handlers: {
  'order.process': async (payload, metadata) => {
    try {
      await processOrder(payload);
    } catch (error) {
      if (isRetryable(error)) {
        throw error;  // Let retry mechanism handle it
      } else {
        await metadata.deadLetter();  // Skip retries, go to DLQ
      }
    }
  },
}
```

### Dead Letter Queue Processing

```typescript
const dlqWorker = queueCraft.createWorker({
  queueName: 'my-queue.dead-letter',
  handlers: {
    '#': async (payload, metadata) => {
      const originalKey = metadata.properties.headers['x-original-routing-key'];
      const error = metadata.properties.headers['x-error'];
      const failedAt = metadata.properties.headers['x-failed-at'];
      
      console.log(`Failed message: ${originalKey}, Error: ${error}`);
      // Log, alert, or attempt recovery
    },
  },
});
```

---

## Advanced Usage

### Multiple Workers

```typescript
// User service worker
const userWorker = queueCraft.createWorker({
  serviceName: 'user-service',
  handlers: {
    'user.created': handleUserCreated,
    'user.updated': handleUserUpdated,
  },
});

// Order service worker
const orderWorker = queueCraft.createWorker({
  serviceName: 'order-service',
  handlers: {
    'order.placed': handleOrderPlaced,
    'order.shipped': handleOrderShipped,
  },
});

await Promise.all([
  userWorker.start(),
  orderWorker.start(),
]);
```

### Environment Variables

```typescript
const queueCraft = QueueCraft.createFromEnv<MyEvents>();
```

Required environment variables:
- `RABBITMQ_HOST`
- `RABBITMQ_PORT`
- `RABBITMQ_USERNAME`
- `RABBITMQ_PASSWORD`
- `RABBITMQ_VHOST` (optional)

### Custom Logger

```typescript
import { WinstonLogger } from 'queue-craft';
import winston from 'winston';

const logger = new WinstonLogger(
  winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()],
  })
);

const queueCraft = new QueueCraft<MyEvents>({
  connection: { /* ... */ },
  logger,
});
```

### Extracting Trace Context

```typescript
handlers: {
  'user.created': async (payload, metadata) => {
    const traceId = metadata.properties.headers?.['x-trace-id'];
    
    // Use trace ID for distributed tracing
    await processWithTracing(payload, traceId);
  },
}
```

---

## Best Practices

1. **Always use explicit queue names** - Use `queueName` for stable queues
2. **Handle errors appropriately** - Throw for retryable errors, use `deadLetter()` for permanent failures
3. **Set appropriate prefetch** - Higher for fast handlers, lower for slow ones
4. **Use structured logging** - Include message IDs and trace context
5. **Graceful shutdown** - Always call `close()` on SIGINT/SIGTERM
6. **Monitor DLQ** - Set up alerts for dead letter queue growth
