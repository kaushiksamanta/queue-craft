# QueueCraft

QueueCraft is a TypeScript-based Node.js framework that simplifies event-driven communication using RabbitMQ (AMQP protocol). It abstracts away the complexities of managing RabbitMQ queues, exchanges, publishing, and consuming messages.

## Features

- **Fully Typed**: Built with TypeScript with strict mode enabled for maximum type safety
- **Async-First Design**: All handlers consistently return Promises for better async/await support
- **Object-Based Handlers**: Handlers are always objects, providing better type safety and predictability
- **Simple API**: Wraps AMQP concepts (exchanges, queues, bindings) in an intuitive API
- **Auto-Setup**: Automatically creates exchanges and queues when workers or publishers start
- **Type-Safe Events**: Define your event payload types for full type safety and inference
- **Flexible Handler Patterns**: Support for multiple handler patterns with automatic event subscription
- **Minimal Boilerplate**: Event subscriptions are automatically derived from handler definitions
- **Robust Error Handling**: Graceful handling of connection errors and message processing failures
- **Retry Mechanism**: Configurable retry logic with exponential backoff
- **Dead Letter Queues**: Automatic routing of unhandled messages to dead letter queues
- **Simplified Error Handling**: Automatic retry mechanism with exponential backoff

## Installation

```bash
npm install queuecraft
```

Or with yarn:

```bash
yarn add queuecraft
```

## Quick Start

### Define Your Event Types

```typescript
// types.ts
import { EventPayloadMap } from 'queuecraft';

export interface MyEventPayloadMap extends EventPayloadMap {
  'user.created': { id: string; name: string; email: string };
  'order.placed': { id: string; userId: string; amount: number };
}
```

### Create a Publisher

```typescript
// publisher.ts
import { QueueCraft } from 'queuecraft';
import { MyEventPayloadMap } from './types';

// Create a QueueCraft instance with your event payload map
const queueCraft = new QueueCraft<MyEventPayloadMap>({
  connection: {
    host: process.env.RABBITMQ_HOST || 'localhost',
    port: parseInt(process.env.RABBITMQ_PORT || '5672', 10),
    username: process.env.RABBITMQ_USERNAME || 'guest',
    password: process.env.RABBITMQ_PASSWORD || 'guest',
  },
});

// Publish an event
async function publishUserCreated() {
  await queueCraft.publishEvent('user.created', {
    id: '123',
    name: 'John Doe',
    email: 'john@example.com',
  });
  console.log('User created event published');
}

publishUserCreated()
  .catch(console.error)
  .finally(() => queueCraft.close());
```

### Create a Worker

```typescript
// worker.ts
import { QueueCraft } from 'queuecraft';
import { MyEventPayloadMap } from './types';

// Create a QueueCraft instance with your event payload map
const queueCraft = new QueueCraft<MyEventPayloadMap>({
  connection: {
    host: process.env.RABBITMQ_HOST || 'localhost',
    port: parseInt(process.env.RABBITMQ_PORT || '5672', 10),
    username: process.env.RABBITMQ_USERNAME || 'guest',
    password: process.env.RABBITMQ_PASSWORD || 'guest',
  },
});

// Create a worker with event-specific handlers
const worker = queueCraft.createWorker<MyEventPayloadMap>({
  // Object-based handlers with async-first design
  handlers: {
    'user.created': async (payload, metadata) => {
      // Handle user.created event with type-safe payload
      console.log(`User created: ${payload.name} (${payload.id})`);
      
      // All handlers are async and return Promise<void>
      await processUserCreation(payload);
      
      // Messages are automatically acknowledged upon successful processing
      // You can use metadata.nack() or metadata.deadLetter() for error scenarios
    },
    'order.placed': async (payload, metadata) => {
      // Handle order.placed event with type-safe payload
      console.log(`Order placed: ${payload.id} for $${payload.amount}`);
      
      try {
        // All handlers are async and return Promise<void>
        await processOrderPlacement(payload);
        
        // You can also use metadata for dead-lettering if needed
        if (someCondition) {
          await metadata.deadLetter();
          return;
        }
        
        // Messages are automatically acknowledged upon successful processing
      } catch (error) {
        // You can handle errors directly in the handler
        console.error(`Error processing order ${payload.id}:`, error);
        
        // Or let it propagate to use the automatic retry mechanism
        throw error;
      }
    }
  },
  options: {
    prefetch: 10,
    queue: {
      durable: true,
    },
    retry: {
      maxRetries: 3,
      initialDelay: 100,
      backoffFactor: 2,
      maxDelay: 5000
    },
    enableDelayQueue: true,
  },
});

// Start the worker
worker.start()
  .then(() => console.log('Worker started'))
  .catch(console.error);

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await worker.close();
  console.log('Worker shut down gracefully');
  process.exit(0);
});
```

## API Reference

### QueueCraft

The main class for managing RabbitMQ connections, publishers, and workers.

```typescript
const queueCraft = new QueueCraft<EventPayloadMap>({
  connection: {
    host: 'localhost',
    port: 5672,
    username: 'guest',
    password: 'guest',
    vhost: '/',
    timeout: 30000,
    heartbeat: 60,
  },
  defaultExchange: {
    type: 'topic',
    durable: true,
    autoDelete: false,
  },
});
```

#### Methods

- **createPublisher(exchangeName?: string, options?: PublisherOptions): Publisher**
  
  Creates a new publisher for the specified exchange.

- **createWorker(config: WorkerConfig, exchangeName?: string): Worker**
  
  Creates a new worker with the specified configuration.

- **publishEvent<E extends keyof T>(event: E, payload: T[E], options?: object, exchangeName?: string): Promise<boolean>**
  
  Publishes an event to the specified exchange.

- **close(): Promise<void>**
  
  Closes all connections, publishers, and workers.

### Publisher

Class for publishing events to RabbitMQ.

```typescript
const publisher = queueCraft.createPublisher('events', {
  exchange: {
    type: 'topic',
    durable: true,
  },
});
```

#### Methods

- **initialize(): Promise<void>**
  
  Initializes the publisher.

- **publish<E extends keyof T>(event: E, payload: T[E], options?: object): Promise<boolean>**
  
  Publishes an event with the specified payload.
- **close(): Promise<void>**
  
  Closes the publisher.

### Handler Pattern

QueueCraft uses a simple object-based handler pattern for maximum type safety and predictability:

```typescript
// Object-based handler pattern
const worker = queueCraft.createWorker<MyEventPayloadMap>({
  handlers: {
    'event.name': async (payload, metadata) => {
      // Process the event with type-safe payload
      // All handlers consistently return Promise<void> (async-first design)
{{ ... }}
    }
  }
});
```

### Advanced Handler Patterns

You can implement advanced patterns within your object-based handlers:

```typescript
const worker = queueCraft.createWorker<MyEventPayloadMap>({
  handlers: {
    'user.created': async (payload, metadata) => {
      // 1. Extract useful metadata
      const { messageId, timestamp, headers } = metadata.properties;
      const traceId = headers['x-trace-id'] || generateTraceId();
      
      // 2. Log with structured context
      logger.info('Processing user.created event', { 
        user: payload.id, 
        traceId, 
        messageId 
      });
      
      // 3. Perform async validation
      const isValid = await validateUser(payload);
      if (!isValid) {
        logger.warn('Invalid user data received', { user: payload.id, traceId });
        await metadata.deadLetter(); // Send to dead letter queue
        return;
      }
      
      // 4. Execute business logic with proper error handling
      try {
        // Transaction handling
        const tx = await db.beginTransaction();
        
        try {
          // Multiple async operations
          await Promise.all([
            createUserRecord(payload, tx),
            sendWelcomeEmail(payload),
            notifyAdminService(payload)
          ]);
          
          await tx.commit();
          logger.info('User created successfully', { user: payload.id, traceId });
        } catch (error) {
          await tx.rollback();
          throw error; // Re-throw to be handled by worker error handler
        }
      } catch (error) {
        // Let the error propagate to use the worker's error handler
        // which will handle retries based on configuration
        throw error;
      }
    }
  },
});
```

## Advanced Usage

### Retry Mechanism

QueueCraft provides a configurable retry mechanism with exponential backoff for handling transient failures:

```typescript
const worker = queueCraft.createWorker<MyEventPayloadMap>({
  handlers: {
    'user.created': async (payload, metadata) => {
      // This handler will be retried up to 3 times if it fails
      await processUser(payload);
    }
  },
  options: {
    retry: {
      maxRetries: 3,           // Maximum number of retry attempts
      initialDelay: 100,       // Initial delay in milliseconds
      backoffFactor: 2,        // Exponential backoff multiplier
      maxDelay: 5000           // Maximum delay between retries in milliseconds
    },
    enableDelayQueue: true,    // Enable delay queue for retry mechanism
  }
});
```



### Automatic Error Handling

QueueCraft now handles errors automatically with a built-in retry mechanism. When an error occurs in a handler, the message is automatically retried with exponential backoff:

```typescript
const worker = queueCraft.createWorker<MyEventPayloadMap>({
  handlers: {
    'user.created': async (payload, metadata) => {
      try {
        // Your processing logic here
        await processUser(payload);
      } catch (error) {
        // You can handle specific errors in your handler
        console.error(`Error processing user: ${error.message}`);
        
        // Or let the error propagate to trigger the automatic retry mechanism
        throw error;
      }
    }
  },
  options: {
    retry: {
      maxRetries: 3,           // Maximum retry attempts
      initialDelay: 1000,      // Initial delay in ms
      backoffFactor: 2,        // Exponential backoff factor
      maxDelay: 10000          // Maximum delay between retries
    },
    enableDelayQueue: true     // Enable delay queue for backoff
  }
});
```

### Logging and Monitoring

QueueCraft provides detailed console logging for monitoring worker activity:

```typescript
// Worker logs important events to the console
// Starting worker
worker.start()
  .then(() => {
    // Logs: "Worker started consuming from queue: queue.user.created.order.placed"
    console.log('Worker is now running');
  });

// Processing logs
// When a message is processed successfully:
// "Successfully processed event: user.created"

// When a message is retried:
// "Retrying message with routing key user.created (attempt 2)"

// When a message is sent to dead letter queue:
// "Sending message to dead letter queue: user.created"

// You can integrate these logs with your monitoring system
```

For advanced monitoring, you can implement your own logging or metrics collection in your handlers.

```typescript
// Error handling with async/await pattern
// Errors are automatically handled with retries and dead letter queue
async function setupWorker() {
  try {
    const worker = queueCraft.createWorker({
      handlers: {
        'user.created': async (payload, metadata) => {
          try {
            // Your processing logic here
            await processUser(payload);
          } catch (error) {
            console.error('Error processing user:', error);
            // Throw the error to trigger the retry mechanism
            throw error;
          }
        }
      },
      options: {
        // Configure retry behavior
        retry: {
          maxRetries: 3,
          initialDelay: 1000, // 1 second
          backoffFactor: 2,   // Exponential backoff
          maxDelay: 10000     // Max 10 seconds
        }
      }
    });
    
    await worker.start();
    console.log('Worker started successfully');
  } catch (error) {
    console.error('Error setting up worker:', error);
  }
}
```

### Dead Letter Queues

Messages that fail processing after all retries are sent to a dead letter queue:

```typescript
// Create a worker to process the dead letter queue
const deadLetterWorker = queueCraft.createWorker({
  handlers: {
    '#': async (payload, metadata) => {
      // Process failed messages
      const originalRoutingKey = metadata.properties.headers['x-original-routing-key'];
      const failedAt = metadata.properties.headers['x-failed-at'];
      const errorMessage = metadata.properties.headers['x-error'];
      
      console.log(`Processing failed message: ${originalRoutingKey}`);
      console.log(`Failed at: ${failedAt}, Error: ${errorMessage}`);
      
      // Store in database or take other recovery action
      await storeFailedMessage(originalRoutingKey, payload, errorMessage);
    }
  },
  options: {
    queue: {
      name: 'your-queue-name.dead-letter',
      durable: true
    }
  }
});

await deadLetterWorker.start();
```

### Using Environment Variables

QueueCraft can be configured using environment variables:

```typescript
import { createFromEnv } from 'queuecraft';

// Create QueueCraft instance from environment variables
const queueCraft = createFromEnv<MyEventPayloadMap>();
```

Supported environment variables:

- `RABBITMQ_HOST`: RabbitMQ host (default: 'localhost')
- `RABBITMQ_PORT`: RabbitMQ port (default: 5672)
- `RABBITMQ_USERNAME`: RabbitMQ username (default: 'guest')
- `RABBITMQ_PASSWORD`: RabbitMQ password (default: 'guest')
- `RABBITMQ_VHOST`: RabbitMQ virtual host
- `RABBITMQ_TIMEOUT`: Connection timeout in milliseconds
- `RABBITMQ_HEARTBEAT`: Heartbeat interval in seconds
- `RABBITMQ_EXCHANGE_TYPE`: Default exchange type (default: 'topic')
- `RABBITMQ_EXCHANGE_DURABLE`: Whether exchanges are durable (default: true)
- `RABBITMQ_EXCHANGE_AUTODELETE`: Whether exchanges are auto-deleted (default: false)

### MessageMetadata

The metadata object passed to event handlers, providing access to message properties and control methods.

```typescript
interface MessageMetadata {
  properties: {
    messageId?: string;
    timestamp?: number;
    headers?: Record<string, any>;
    [key: string]: any;
  };
  fields?: {
    routingKey: string;
    exchange: string;
    [key: string]: any;
  };
  nack: () => void;       // Negative acknowledge without requeuing
  requeue: () => void;    // Requeue the message
  deadLetter?: () => Promise<void>; // Send to dead letter queue
}
```

**Note**: Messages are automatically acknowledged upon successful handler execution. The `ack()` method has been removed as part of our async-first design pattern to simplify the API and make message handling more predictable.

### Custom Message Handling

You can access message metadata and manually acknowledge messages:

```typescript
const worker = queueCraft.createWorker<MyEventPayloadMap>({
  handlers: {
    'event.name': async (payload, metadata) => {
      try {
        // Process the event with type-safe payload
        await processEvent(payload);
        
        // Acknowledgement is handled automatically
      } catch (error) {
        // Negative acknowledge the message on failure (rejects without requeuing)
        metadata.nack();
        
        // If you want to put the message back in the queue instead, use:
        // metadata.requeue();
        
        // All handlers consistently return Promise<void>
        // Error handling doesn't break this pattern
      }
    }
  },
  options: {
    autoAck: false, // Disable auto-acknowledgement
  },
});
```

## Examples

Check out the [examples](./examples) directory for complete working examples:

- [Publisher Service](./examples/publisher-service/index.ts): Example of publishing events
- [Worker Service](./examples/worker-service/index.ts): Example of consuming events

## Development

### Prerequisites

- Node.js 14+
- RabbitMQ (or Docker for local development)

### Local Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Start RabbitMQ: `docker-compose up -d`
4. Run tests: `npm test`
5. Build the package: `npm run build`

### Running the Examples

1. Start RabbitMQ: `docker-compose up -d`
2. Build the package: `npm run build`
3. Start the worker service: `npm run example:worker`
4. In another terminal, run the publisher service: `npm run example:publisher`

## License

MIT
