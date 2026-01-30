# QueueCraft Usage Guide

Complete API reference and usage examples for QueueCraft.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Publisher API](#publisher-api)
- [Worker API](#worker-api)
- [Error Handling](#error-handling)
- [Health Checks](#health-checks)
- [Graceful Shutdown](#graceful-shutdown)
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
  reconnection: {            // Optional - auto-reconnect settings
    autoReconnect: true,     // Enable auto-reconnect (default: true)
    maxAttempts: 10,         // Max reconnection attempts (default: 10)
    initialDelay: 1000,      // Initial delay ms (default: 1000)
    maxDelay: 30000,         // Max delay ms (default: 30000)
    backoffFactor: 2,        // Exponential backoff (default: 2)
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
// Basic publish (fire-and-forget)
await publisher.publish('user.created', { id: '123', name: 'John' });

// With options
await publisher.publish('user.created', payload, {
  messageId: 'unique-id',
  timestamp: Date.now(),
  headers: {
    'x-trace-id': 'abc123',
  },
});

// With broker confirmation (guaranteed delivery)
await publisher.publishWithConfirm('user.created', payload, {
  timeout: 5000,  // Optional timeout in ms (default: 5000)
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

Create a dedicated worker to process failed messages from the dead letter queue:

```typescript
const dlqWorker = queueCraft.createWorker({
  queueName: 'my-queue.dead-letter',
  handlers: {
    // Handle specific failed events
    'user.created': async (payload, metadata) => {
      const originalKey = metadata.properties.headers?.['x-original-routing-key'];
      const error = metadata.properties.headers?.['x-error'];
      const failedAt = metadata.properties.headers?.['x-failed-at'];
      
      console.log(`Failed message: ${originalKey}, Error: ${error}`);
      // Log, alert, or attempt recovery
    },
    'order.placed': async (payload, metadata) => {
      // Handle failed order events
    },
  },
});
```

> **Note:** Messages without a matching handler will remain in the dead letter queue. Ensure you have handlers for all event types that might fail.

---

## Health Checks

Monitor connection status for load balancers and health endpoints:

```typescript
// Simple boolean check
if (queueCraft.isHealthy()) {
  // Ready to process messages
}

// Detailed health status
const health = queueCraft.getHealth();
console.log(health);
// {
//   healthy: true,
//   connection: {
//     connected: true,
//     reconnecting: false,
//     reconnectAttempts: 0,
//     lastConnectedAt: Date,
//     lastDisconnectedAt: Date,
//     lastError: Error | undefined
//   },
//   publishers: 2,
//   workers: 3,
//   timestamp: Date
// }

// Express health endpoint example
app.get('/health', (req, res) => {
  const health = queueCraft.getHealth();
  res.status(health.healthy ? 200 : 503).json(health);
});
```

### Connection Events

Listen to connection events for monitoring:

```typescript
const connectionManager = queueCraft.getConnectionManager();

connectionManager.on('connected', ({ timestamp }) => {
  console.log('Connected to RabbitMQ at', timestamp);
});

connectionManager.on('disconnected', ({ error, timestamp }) => {
  console.log('Disconnected from RabbitMQ:', error?.message);
});

connectionManager.on('reconnecting', ({ attempt, maxAttempts, delay }) => {
  console.log(`Reconnecting... attempt ${attempt}/${maxAttempts} in ${delay}ms`);
});

connectionManager.on('reconnected', ({ attempts }) => {
  console.log('Reconnected after', attempts, 'attempts');
});

connectionManager.on('reconnectFailed', ({ attempts, lastError }) => {
  console.error('Failed to reconnect after', attempts, 'attempts:', lastError);
});
```

---

## Graceful Shutdown

### Built-in Signal Handling

Enable automatic graceful shutdown on SIGTERM/SIGINT:

```typescript
queueCraft.enableGracefulShutdown({
  timeout: 30000,              // Max time to wait for shutdown (default: 30000)
  signals: ['SIGTERM', 'SIGINT'],  // Signals to handle (default)
  beforeShutdown: async () => {
    console.log('Preparing to shut down...');
    // Finish in-flight requests, flush logs, etc.
  },
  afterShutdown: async () => {
    console.log('Shutdown complete');
    // Final cleanup
  },
});

// Disable if needed
queueCraft.disableGracefulShutdown();
```

### Manual Shutdown

```typescript
// In your signal handler
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await queueCraft.close();  // Stops workers, closes connections
  process.exit(0);
});
```

---

## Advanced Usage

### Multiple Workers

```typescript
// User service worker
const userWorker = queueCraft.createWorker({
  queueName: 'user-service',
  handlers: {
    'user.created': handleUserCreated,
    'user.updated': handleUserUpdated,
  },
});

// Order service worker
const orderWorker = queueCraft.createWorker({
  queueName: 'order-service',
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
import { createFromEnv } from 'queue-craft';

const queueCraft = createFromEnv<MyEvents>();
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

const logger = new WinstonLogger({
  level: 'info',
  colorize: true,
  timestamp: true,
  silent: false,  // Set to true for testing
});

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
5. **Enable graceful shutdown** - Use `enableGracefulShutdown()` for clean termination
6. **Monitor health** - Expose `getHealth()` endpoint for load balancers
7. **Use publisher confirms** - Use `publishWithConfirm()` for critical messages
8. **Monitor DLQ** - Set up alerts for dead letter queue growth
