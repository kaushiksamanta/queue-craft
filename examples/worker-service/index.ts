import { QueueCraft } from '../../src';
import { ExampleEventPayloadMap } from '../shared-types';
import { MessageMetadata } from '../../src/types';

// Create a QueueCraft instance with our event payload map
const queueCraft = new QueueCraft<ExampleEventPayloadMap>({
  connection: {
    host: process.env.RABBITMQ_HOST || 'localhost',
    port: parseInt(process.env.RABBITMQ_PORT || '5672', 10),
    username: process.env.RABBITMQ_USERNAME || 'guest',
    password: process.env.RABBITMQ_PASSWORD || 'guest',
  },
});

// Helper function to process dead letter messages
async function processDeadLetterMessage(payload: any, metadata: MessageMetadata): Promise<void> {
  // Extract error information from headers
  const originalRoute = metadata.properties.headers?.['x-original-routing-key'] || 'unknown';
  const errorMessage = metadata.properties.headers?.['x-error'] || 'Unknown error';
  const failedAt = metadata.properties.headers?.['x-failed-at'] || 'Unknown time';
  const messageId = metadata.properties.messageId || 'unknown';
  
  console.log(`\n[DEAD LETTER WORKER] Processing dead letter message:`);
  console.log(`Message ID: ${messageId}`);
  console.log(`Original routing key: ${originalRoute}`);
  console.log(`Error: ${errorMessage}`);
  console.log(`Failed at: ${failedAt}`);
  console.log(`Payload: ${JSON.stringify(payload, null, 2)}`);
  
  // Demonstrate comprehensive dead letter handling
  try {
    // 1. Log to monitoring system (simulated)
    console.log(`Logging to error monitoring system...`);
    await new Promise(resolve => setTimeout(resolve, 20));
    
    // 2. Categorize the error
    let errorCategory = 'unknown';
    if (errorMessage.includes('validation')) {
      errorCategory = 'validation_error';
    } else if (errorMessage.includes('timeout')) {
      errorCategory = 'timeout_error';
    } else if (errorMessage.includes('transient')) {
      errorCategory = 'transient_error';
    }
    
    console.log(`Categorized as: ${errorCategory}`);
    
    // 3. Demonstrate recovery logic based on error type
    switch (errorCategory) {
      case 'validation_error':
        console.log(`Storing in validation errors database for manual review...`);
        await new Promise(resolve => setTimeout(resolve, 30));
        break;
        
      case 'timeout_error':
        console.log(`Scheduling for automatic retry during off-peak hours...`);
        await new Promise(resolve => setTimeout(resolve, 25));
        break;
        
      case 'transient_error':
        console.log(`Attempting immediate fix and republish...`);
        await new Promise(resolve => setTimeout(resolve, 40));
        console.log(`Message fixed and republished to original queue`);
        break;
        
      default:
        console.log(`Storing in general error database for analysis...`);
        await new Promise(resolve => setTimeout(resolve, 15));
    }
    
    console.log(`Dead letter processing complete for message ${messageId}`);
  } catch (error) {
    console.error(`Error in dead letter processing: ${error instanceof Error ? error.message : 'Unknown error'}`);
    // In production, you would likely log this error but not re-throw it
    // to prevent the dead letter handler itself from failing
  }
}

async function runWorkerDemo() {
  console.log('Worker service starting...');

  try {
    // Basic worker with simple handlers - demonstrating async-first pattern
    const basicWorker = queueCraft.createWorker<ExampleEventPayloadMap>({
      handlers: {
        'user.created': async (payload, metadata) => {
          console.log(`\n[BASIC WORKER] Processing user.created event`);
          console.log(`User: ${payload.name} (${payload.id})`);
          console.log(`Email: ${payload.email}`);
          console.log(`Created at: ${payload.createdAt}`);
          
          // Simulate async database operation
          await new Promise(resolve => setTimeout(resolve, 50));
          console.log(`User ${payload.id} saved to database`);
          
          // Demonstrate metadata access
          if (metadata.properties.messageId) {
            console.log(`Message ID: ${metadata.properties.messageId}`);
          }
          
          // Show timestamp handling
          const timestamp = metadata.properties.timestamp;
          if (timestamp) {
            const date = new Date(timestamp);
            console.log(`Message timestamp: ${date.toISOString()}`);
          }
        },
        'order.placed': async (payload, metadata) => {
          console.log(`\n[BASIC WORKER] Processing order.placed event`);
          console.log(`Order ID: ${payload.id}`);
          console.log(`User ID: ${payload.userId}`);
          console.log(`Amount: $${payload.total.toFixed(2)}`);
          console.log(`Items: ${payload.items.length}`);
          
          // Simulate order processing
          console.log(`Processing order...`);
          await new Promise(resolve => setTimeout(resolve, 100));
          console.log(`Order ${payload.id} processed successfully`);
          
          // Demonstrate metadata usage for tracing
          const traceId = metadata.properties.headers?.['x-trace-id'];
          if (traceId) {
            console.log(`Trace ID: ${traceId}`);
          }
        }
      },
      options: {
        queue: {
          durable: true
        }
      }
    });
    
    // Error handling worker with retry mechanism and dead letter queue
    const errorHandlingWorker = queueCraft.createWorker<ExampleEventPayloadMap>({
      handlers: {
        // This handler demonstrates comprehensive error handling patterns
        'notification.email': async (payload, metadata) => {
          console.log(`\n[ERROR HANDLING WORKER] Processing email notification`);
          console.log(`To: ${payload.recipient}, Subject: ${payload.subject}`);
          // Get retry count from headers
          const retryCount = metadata.properties.headers?.['x-retry-count'] || 0;
          console.log(`Attempt #${retryCount + 1}`);
          
          // Validate input data
          if (!payload.recipient.includes('@')) {
            console.error(`Invalid email address: ${payload.recipient}`);  
            // Business validation failure - send to dead letter queue
            console.log(`Sending to dead letter queue due to invalid email format`);
            await metadata.deadLetter?.();
            return;
          }
          
          // Demonstrate retry-able vs. non-retry-able errors
          if (payload.recipient.includes('permanent-fail')) {
            console.log('Simulating a permanent failure (will not retry)...');
            // Create a custom error with metadata
            const error = new Error('Permanent failure in email processing');
            // @ts-expect-error - Adding custom property to Error object for error type classification
            error.permanent = true;
            throw error;
          } else if (payload.recipient.includes('temp-fail')) {
            console.log('Simulating a transient failure (will retry)...');
            throw new Error('Temporary failure in email processing');
          }
          
          // Simulate multi-step async processing with proper error handling
          try {
            console.log(`Step 1: Validating email template...`);
            await new Promise(resolve => setTimeout(resolve, 20));
            
            console.log(`Step 2: Personalizing content...`);
            await new Promise(resolve => setTimeout(resolve, 30));
            
            console.log(`Step 3: Sending email...`);
            await new Promise(resolve => setTimeout(resolve, 50));
            
            console.log('Email notification processed successfully');
          } catch (error) {
            console.error(`Error in email processing pipeline: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw error; // Re-throw to trigger retry mechanism
          }
        },
        'notification.sms': async (payload, metadata) => {
          console.log(`\n[ERROR HANDLING WORKER] Processing SMS notification`);
          console.log(`To: ${payload.phoneNumber}, Content length: ${payload.content.length}`);
          
          // Demonstrate retry count access
          // Get retry count from headers
          const retryCount = metadata.properties.headers?.['x-retry-count'] || 0;
          console.log(`Processing attempt #${retryCount + 1}`);
          
          // Simulate backoff behavior
          if (retryCount > 0) {
            console.log(`This is retry attempt #${retryCount}, adding extra processing time...`);
            await new Promise(resolve => setTimeout(resolve, retryCount * 100));
          }
          
          // Simulate successful processing
          console.log(`Sending SMS message...`);
          await new Promise(resolve => setTimeout(resolve, 30));
          console.log(`SMS notification sent successfully`);
        }
      },
      options: {
        prefetch: 3,
        // Auto-acknowledgment is always enabled by default
        // Retry mechanism works automatically
        queue: {
          durable: true,
        },
        retry: {
          maxRetries: 3,
          initialDelay: 1000, // 1 second
          backoffFactor: 2,   // Exponential backoff
          maxDelay: 10000     // Max 10 seconds
        }
      }
    });
    
    // Dead letter queue worker - using a generic type to allow any payload
    const deadLetterWorker = queueCraft.createWorker<{'dead-letter': any}>({
      handlers: {
        'dead-letter': async (payload, metadata) => {
          await processDeadLetterMessage(payload, metadata);
        }
      },
      options: {
        queue: {
          durable: true
        }
      }
    });
    
    // Start all workers
    await Promise.all([
      basicWorker.start(),
      errorHandlingWorker.start(),
      deadLetterWorker.start()
    ]);
    
    console.log('All workers started successfully!');
  } catch (error) {
    console.error('Error starting workers:', error);
    process.exit(1);
  }
}

runWorkerDemo().catch(err => {
  console.error('Unhandled error in worker demo:', err);
  process.exit(1);
});
