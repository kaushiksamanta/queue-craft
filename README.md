# QueueCraft

A TypeScript framework for event-driven communication with RabbitMQ. Type-safe, simple, and reliable.

## Features

- **Type-Safe** - Full TypeScript support with strict mode
- **Simple API** - Intuitive publisher/worker pattern
- **Auto-Setup** - Exchanges, queues, and bindings created automatically
- **Reliable** - Built-in retries with exponential backoff
- **Dead Letter Queues** - Failed messages automatically routed to DLQ

## Installation

```bash
npm install queue-craft
```

## Quick Start

### Define Events

```typescript
import { EventPayloadMap } from 'queue-craft';

export interface MyEvents extends EventPayloadMap {
  'user.created': { id: string; name: string; email: string };
  'order.placed': { orderId: string; amount: number };
}
```

### Publisher

```typescript
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

await publisher.publish('user.created', {
  id: '123',
  name: 'John Doe',
  email: 'john@example.com',
});

await queueCraft.close();
```

### Worker

```typescript
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
  queueName: 'user-service',  // Required: stable queue name
  handlers: {
    'user.created': async (payload, metadata) => {
      console.log(`User created: ${payload.name}`);
    },
    'order.placed': async (payload, metadata) => {
      console.log(`Order placed: $${payload.amount}`);
    },
  },
  options: {
    prefetch: 10,
    retry: {
      maxRetries: 3,
      initialDelay: 100,
      backoffFactor: 2,
      maxDelay: 5000,
    },
  },
});

await worker.start();

process.on('SIGINT', async () => {
  await worker.close();
  process.exit(0);
});
```

## Documentation

- **[Architecture](./docs/architecture.md)** - RabbitMQ concepts, message flow diagrams
- **[Usage Guide](./docs/usage.md)** - Complete API reference and examples

## Examples

See the [examples](./examples) directory:

- [Publisher Service](./examples/publisher-service/index.ts)
- [Worker Service](./examples/worker-service/index.ts)

## Development

```bash
# Install dependencies
npm install

# Start RabbitMQ
docker-compose up -d

# Run tests
npm test

# Build
npm run build
```

## License

MIT
