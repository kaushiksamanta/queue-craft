# QueueCraft Architecture

This document explains how RabbitMQ processes messages through exchanges, queues, and bindings, and how QueueCraft abstracts these concepts.

## Table of Contents

- [RabbitMQ Core Concepts](#rabbitmq-core-concepts)
- [Exchange Types](#exchange-types)
- [Message Flow](#message-flow)
- [Retry & Dead Letter Queue](#retry--dead-letter-queue)
- [Connection Architecture](#connection-architecture)

---

## RabbitMQ Core Concepts

### The AMQP Model

```mermaid
flowchart LR
    subgraph Producer["Producer (Publisher)"]
        P[Application Code]
    end
    
    subgraph RabbitMQ["RabbitMQ Broker"]
        E[Exchange]
        Q1[Queue 1]
        Q2[Queue 2]
        Q3[Queue 3]
        
        E -->|Binding: user.*| Q1
        E -->|Binding: order.*| Q2
        E -->|Binding: #| Q3
    end
    
    subgraph Consumers["Consumers (Workers)"]
        W1[Worker 1]
        W2[Worker 2]
        W3[Worker 3]
    end
    
    P -->|Publish Message| E
    Q1 -->|Consume| W1
    Q2 -->|Consume| W2
    Q3 -->|Consume| W3
```

### Key Components

| Component | Description | QueueCraft Abstraction |
|-----------|-------------|------------------------|
| **Producer** | Application that sends messages | `Publisher` class |
| **Exchange** | Receives messages and routes them to queues | Auto-created on publish |
| **Binding** | Rule linking exchange to queue with routing pattern | Auto-created from handlers |
| **Queue** | Buffer storing messages until consumed | Named via `queueName` or `serviceName` |
| **Consumer** | Application receiving and processing messages | `Worker` class |

---

## Exchange Types

QueueCraft defaults to **Topic** exchange but supports all types.

### Topic Exchange (Default)

```mermaid
flowchart TB
    subgraph Publisher
        P1["publish('user.created', payload)"]
        P2["publish('user.updated', payload)"]
        P3["publish('order.placed', payload)"]
    end
    
    subgraph Exchange["Topic Exchange: 'events'"]
        EX((Exchange))
    end
    
    subgraph Queues
        Q1["user-service"]
        Q2["order-service"]
    end
    
    P1 --> EX
    P2 --> EX
    P3 --> EX
    
    EX -->|user.*| Q1
    EX -->|order.*| Q2
```

**Routing Patterns:**

| Pattern | Matches | Example |
|---------|---------|---------|
| `user.created` | Exact match only | `user.created` ✅ |
| `user.*` | One word after `user.` | `user.created` ✅, `user.updated` ✅ |
| `user.#` | Zero or more words | `user.created` ✅, `user.profile.updated` ✅ |
| `#` | All messages | Everything ✅ |

### Direct Exchange

Routes messages where `binding_key` exactly matches `routing_key`.

```mermaid
flowchart LR
    P["publish('error', payload)"] --> EX((Direct Exchange))
    EX -->|exact match| Q1["error-queue"]
    EX -.->|no match| Q2["warning-queue"]
```

### Fanout Exchange

Broadcasts messages to ALL bound queues (ignores routing key).

```mermaid
flowchart LR
    P["publish(payload)"] --> EX((Fanout Exchange))
    EX -->|broadcast| Q1["notification-queue"]
    EX -->|broadcast| Q2["analytics-queue"]
    EX -->|broadcast| Q3["audit-queue"]
```

---

## Message Flow

### Complete Publish-Consume Lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant App as Application
    participant Pub as Publisher
    participant Ex as Exchange
    participant Q as Queue
    participant W as Worker
    participant H as Handler

    Note over App,H: PUBLISHING
    App->>Pub: publisher.publish('user.created', payload)
    Pub->>Ex: Send message with routing key
    Ex->>Q: Route to bound queues

    Note over App,H: CONSUMING
    W->>Q: channel.consume(queue)
    Q-->>W: Deliver message
    W->>H: handler(payload, metadata)

    alt Success
        H-->>W: Promise resolves
        W->>Q: ACK - remove message
    else Error + Retries Left
        H-->>W: Promise rejects
        W->>Q: Requeue to delay queue
    else Max Retries Exceeded
        W->>Q: Send to dead letter queue
    end
```

### How Bindings Are Created

When you define handlers, QueueCraft automatically creates bindings:

```typescript
const worker = queueCraft.createWorker({
  queueName: 'user-service',
  handlers: {
    'user.created': handleUserCreated,
    'user.updated': handleUserUpdated,
  }
})
```

```mermaid
flowchart TB
    subgraph Config["Worker Configuration"]
        HC["handlers: { 'user.created', 'user.updated' }"]
    end
    
    subgraph Created["RabbitMQ State"]
        EX["Exchange: 'events'"]
        Q["Queue: 'user-service'"]
        B1["Binding: 'user.created'"]
        B2["Binding: 'user.updated'"]
    end
    
    HC --> EX
    HC --> Q
    EX --- B1 --- Q
    EX --- B2 --- Q
```

---

## Retry & Dead Letter Queue

### Retry Flow with Exponential Backoff

```mermaid
flowchart TB
    subgraph MainFlow["Main Flow"]
        Q1["Main Queue"]
        W["Worker"]
        H["Handler"]
    end
    
    subgraph RetryFlow["Retry Flow"]
        DQ["Delay Queue<br/>(TTL-based)"]
    end
    
    subgraph DLQFlow["Dead Letter Flow"]
        DLQ["Dead Letter Queue"]
    end
    
    Q1 -->|1. Deliver| W
    W -->|2. Process| H
    
    H -->|Success| ACK["ACK ✓"]
    
    H -->|Error + retries left| W
    W -->|3. Requeue with delay| DQ
    DQ -->|4. After TTL| Q1
    
    H -->|Max retries exceeded| W
    W -->|5. Dead letter| DLQ
    
    style ACK fill:#90EE90
    style DLQ fill:#FFB6C1
```

### Retry Timing

With default config: `maxRetries=3, initialDelay=100ms, backoffFactor=2`

| Attempt | Delay | Total Wait |
|---------|-------|------------|
| 1 | 100ms | 100ms |
| 2 | 200ms | 300ms |
| 3 | 400ms | 700ms |
| 4 | → DLQ | - |

---

## Connection Architecture

### Connection Reconnection

QueueCraft automatically handles connection failures with exponential backoff:

```mermaid
sequenceDiagram
    participant App as Application
    participant CM as ConnectionManager
    participant RMQ as RabbitMQ

    App->>CM: connect()
    CM->>RMQ: TCP Connection
    RMQ-->>CM: Connected ✓
    CM-->>App: emit('connected')

    Note over CM,RMQ: Connection Lost
    RMQ--xCM: Connection Error
    CM-->>App: emit('disconnected')

    loop Reconnection Attempts
        CM->>CM: Wait (exponential backoff)
        CM-->>App: emit('reconnecting', { attempt })
        CM->>RMQ: Reconnect
        alt Success
            RMQ-->>CM: Connected ✓
            CM-->>App: emit('reconnected')
        else Failure
            RMQ--xCM: Error
            CM->>CM: Increment attempt
        end
    end

    alt Max Attempts Exceeded
        CM-->>App: emit('reconnectFailed')
    end
```

**Reconnection Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `autoReconnect` | `true` | Enable automatic reconnection |
| `maxAttempts` | `10` | Maximum reconnection attempts |
| `initialDelay` | `1000ms` | Initial delay before first retry |
| `maxDelay` | `30000ms` | Maximum delay between retries |
| `backoffFactor` | `2` | Exponential backoff multiplier |

### Health Checks

QueueCraft provides health check methods for monitoring:

```typescript
// Simple boolean check
if (queueCraft.isHealthy()) {
  // Ready to process
}

// Detailed health status
const health = queueCraft.getHealth();
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
```

### QueueCraft Component Structure

```mermaid
flowchart TB
    subgraph Application["Node.js Application"]
        QC["QueueCraft Instance"]
        CM["ConnectionManager"]
        
        subgraph Publishers
            P1["Publisher 1"]
            P2["Publisher 2"]
        end
        
        subgraph Workers
            W1["Worker 1"]
            W2["Worker 2"]
        end
    end
    
    subgraph RabbitMQ["RabbitMQ Broker"]
        CONN["TCP Connection"]
        CH["Channel"]
        EX["Exchanges"]
        Q["Queues"]
    end
    
    QC --> CM
    P1 --> CM
    P2 --> CM
    W1 --> CM
    W2 --> CM
    
    CM --> CONN --> CH
    CH --> EX
    CH --> Q
```

### Message Acknowledgment States

```mermaid
stateDiagram-v2
    [*] --> Unacked: Message Delivered
    
    Unacked --> Acknowledged: channel.ack()
    Unacked --> Rejected: metadata.nack()
    Unacked --> Requeued: metadata.requeue()
    
    Acknowledged --> [*]: Removed from Queue
    Rejected --> [*]: Discarded
    Requeued --> Unacked: Back to Queue
```

| Method | Effect |
|--------|--------|
| `(auto)` | Message ACKed on successful handler completion |
| `metadata.nack()` | Reject message, don't requeue |
| `metadata.requeue()` | Put message back in queue |
| `metadata.deadLetter()` | Send to dead letter queue |

---

## Entity Relationship

```mermaid
erDiagram
    QueueCraft ||--o{ Publisher : creates
    QueueCraft ||--o{ Worker : creates
    QueueCraft ||--|| ConnectionManager : uses
    
    Publisher ||--|| Exchange : publishes-to
    Worker ||--|| Queue : consumes-from
    Worker ||--o{ EventHandler : contains
    
    Exchange ||--o{ Binding : has
    Binding ||--|| Queue : routes-to
    
    Queue ||--o{ Message : stores
    
    Worker ||--o| DelayQueue : uses-for-retry
    Worker ||--o| DeadLetterQueue : uses-for-failures
```

---

## Publisher Confirms

For guaranteed message delivery, use publisher confirms:

```mermaid
sequenceDiagram
    participant App as Application
    participant Pub as Publisher
    participant Ch as Confirm Channel
    participant RMQ as RabbitMQ

    App->>Pub: publishWithConfirm('event', payload)
    Pub->>Ch: publish(exchange, routingKey, content)
    Ch->>RMQ: Send message
    
    alt Broker Confirms
        RMQ-->>Ch: ACK
        Ch-->>Pub: Callback(null)
        Pub-->>App: Promise resolves ✓
    else Broker Rejects
        RMQ-->>Ch: NACK
        Ch-->>Pub: Callback(error)
        Pub-->>App: Promise rejects ✗
    else Timeout
        Pub-->>App: Promise rejects (timeout)
    end
```

**Usage:**

```typescript
// Fire-and-forget (fast, no guarantee)
await publisher.publish('user.created', payload);

// With confirmation (slower, guaranteed delivery)
await publisher.publishWithConfirm('user.created', payload, {
  timeout: 5000  // Optional timeout in ms
});
```
