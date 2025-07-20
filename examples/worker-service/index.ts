import { QueueCraft } from '../../src';
import { ExampleEventPayloadMap } from '../shared-types';
import { MessageMetadata } from '../../src/types';
import { WinstonLogger, WinstonLoggerOptions } from '../../src/logger';
import winston from 'winston';

function createCustomWinstonLogger(): WinstonLogger {
  const logFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }: Record<string, any>) => {
      const metaString = Object.keys(meta).length ? JSON.stringify(meta) : '';
      return `[${timestamp}] ${level}: ${message} ${metaString}`;
    })
  );

  const options: WinstonLoggerOptions = {
    level: 'debug',
    transports: [
      new winston.transports.Console({
        format: logFormat,
      }),
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
      }),
      new winston.transports.File({
        filename: 'logs/combined.log',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
      }),
    ],
  };

  return new WinstonLogger(options);
}

async function recordInvalidPhoneNumber(phoneNumber: string): Promise<void> {
  logger.warn(`Recording invalid phone number: ${phoneNumber} for further analysis`);
  return Promise.resolve();
}

const logger = createCustomWinstonLogger();

const queueCraft = new QueueCraft<ExampleEventPayloadMap>({
  connection: {
    host: process.env.RABBITMQ_HOST || 'localhost',
    port: parseInt(process.env.RABBITMQ_PORT || '5672'),
    username: process.env.RABBITMQ_USERNAME || 'guest',
    password: process.env.RABBITMQ_PASSWORD || 'guest',
  },
  logger,
});

async function processDeadLetterMessage(payload: any, metadata: MessageMetadata): Promise<void> {
  const originalRoute = metadata.properties.headers?.['x-original-routing-key'] || 'unknown';
  const errorMessage = metadata.properties.headers?.['x-error'] || 'Unknown error';
  const failedAt = metadata.properties.headers?.['x-failed-at'] || 'Unknown time';
  const messageId = metadata.properties.messageId || 'unknown';
  
  logger.info(`\n[DEAD LETTER WORKER] Processing dead letter message:`, {
    messageId,
    originalRoute,
    errorMessage,
    failedAt,
    payload
  });
  
  try {
    logger.debug(`Logging to error monitoring system...`);
    await new Promise(resolve => setTimeout(resolve, 20));
    
    let errorCategory = 'unknown';
    if (errorMessage.includes('validation')) {
      errorCategory = 'validation_error';
    } else if (errorMessage.includes('timeout')) {
      errorCategory = 'timeout_error';
    } else if (errorMessage.includes('transient')) {
      errorCategory = 'transient_error';
    }
    
    logger.info(`Categorized as: ${errorCategory}`);
    
    switch (errorCategory) {
      case 'validation_error':
        logger.info(`Storing in validation errors database for manual review...`);
        await new Promise(resolve => setTimeout(resolve, 30));
        break;
        
      case 'timeout_error':
        logger.info(`Scheduling for automatic retry during off-peak hours...`);
        await new Promise(resolve => setTimeout(resolve, 25));
        break;
        
      case 'transient_error':
        logger.info(`Attempting immediate fix and republish...`);
        await new Promise(resolve => setTimeout(resolve, 40));
        logger.info(`Message fixed and republished to original queue`);
        break;
        
      default:
        logger.info(`Storing in general error database for analysis...`);
        await new Promise(resolve => setTimeout(resolve, 15));
    }
    
    logger.info(`Dead letter processing complete for message ${messageId}`);
  } catch (error) {
    logger.error(`Error in dead letter processing:`, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

async function runWorkerDemo() {
  logger.info('Worker service starting...');

  try {
    const basicWorker = queueCraft.createWorker({
      handlers: {
        'user.created': async (payload, metadata) => {
          logger.info(`Processing user.created event`, {
            user: `${payload.name} (${payload.id})`,
            email: payload.email,
            createdAt: payload.createdAt
          });
          
          await new Promise(resolve => setTimeout(resolve, 50));
          logger.info(`User ${payload.id} saved to database`);
          
          if (metadata.properties.messageId) {
            logger.debug(`Message ID: ${metadata.properties.messageId}`);
          }
          
          const timestamp = metadata.properties.timestamp;
          if (timestamp) {
            const date = new Date(timestamp);
            logger.debug(`Message timestamp: ${date.toISOString()}`);
          }
        },
        'order.placed': async (payload, metadata) => {
          logger.info(`Processing order.placed event`, {
            orderId: payload.id,
            userId: payload.userId,
            amount: `$${payload.total.toFixed(2)}`,
            itemCount: payload.items.length
          });
          
          logger.info(`Processing order...`);
          await new Promise(resolve => setTimeout(resolve, 100));
          logger.info(`Order ${payload.id} processed successfully`);
          
          const traceId = metadata.properties.headers?.['x-trace-id'];
          if (traceId) {
            logger.debug(`Trace ID: ${traceId}`);
          }
        }
      },
      options: {
        queue: {
          durable: true
        }
      }
    });
    
    const errorHandlingWorker = queueCraft.createWorker({
      handlers: {
        'notification.email': async (payload, metadata) => {
          logger.info(`Processing email notification`, {
            recipient: payload.recipient,
            subject: payload.subject
          });
          const retryCount = metadata.properties.headers?.['x-retry-count'] || 0;
          logger.info(`Attempt #${retryCount + 1}`);
          
          if (!payload.recipient.includes('@')) {
            logger.error(`Invalid email address: ${payload.recipient}`);  
            logger.warn(`Invalid email format - sending directly to dead letter queue`);
            if (metadata.deadLetter) {
              await metadata.deadLetter();
              logger.info('Message sent to dead letter queue');
              logger.debug('We can perform additional operations here if needed...');
            } else {
              logger.warn('Dead letter function not available, throwing error instead');
              throw new Error('Invalid email format');
            }
          }
          
          // Demonstrate retry-able vs. non-retry-able errors
          if (payload.recipient.includes('permanent-fail')) {
            logger.warn('Simulating a permanent failure (will not retry)...');
            // Create a custom error with metadata
            const error = new Error('Permanent failure in email processing');
            // @ts-expect-error - Adding custom property to Error object for error type classification
            error.permanent = true;
            throw error;
          } else if (payload.recipient.includes('temp-fail')) {
            logger.warn('Simulating a transient failure (will retry)...');
            throw new Error('Temporary failure in email processing');
          }
          
          try {
            logger.debug(`Step 1: Validating email template...`);
            await new Promise(resolve => setTimeout(resolve, 20));
            
            logger.debug(`Step 2: Personalizing content...`);
            await new Promise(resolve => setTimeout(resolve, 30));
            
            logger.debug(`Step 3: Sending email...`);
            await new Promise(resolve => setTimeout(resolve, 50));
            
            logger.info('Email notification processed successfully');
          } catch (error) {
            logger.error(`Error in email processing pipeline:`, { error: error instanceof Error ? error.message : 'Unknown error' });
            throw error; // Re-throw to trigger retry mechanism
          }
        },
        'notification.sms': async (payload, metadata) => {
          logger.info(`Processing SMS notification`, {
            phoneNumber: payload.phoneNumber,
            contentLength: payload.content.length
          });
          
          const retryCount = metadata.properties.headers?.['x-retry-count'] || 0;
          logger.info(`Processing attempt #${retryCount + 1}`);
          
          if (payload.phoneNumber.includes('service-down')) {
            logger.warn('External SMS service appears to be down, requeuing message for later');
            metadata.requeue();
            logger.info('Requeue operation completed, message will be processed later');
            logger.debug('No need to return early with the improved implementation!');
          }
          
          if (payload.phoneNumber.length < 10) {
            logger.warn('Invalid phone number, sending negative acknowledgment without requeue');
            metadata.nack();
            logger.info('Invalid message rejected, performing cleanup operations...');
            await recordInvalidPhoneNumber(payload.phoneNumber);
          }
          
          if (retryCount > 0) {
            logger.info(`This is retry attempt #${retryCount}, adding extra processing time...`);
            await new Promise(resolve => setTimeout(resolve, retryCount * 100));
          }
          
          logger.debug(`Sending SMS message...`);
          await new Promise(resolve => setTimeout(resolve, 30));
          logger.info(`SMS notification sent successfully`);
        }
      },
      options: {
        prefetch: 3,
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
    
    const deadLetterWorker = queueCraft.createWorker({
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
    
    await Promise.all([
      basicWorker.start(),
      errorHandlingWorker.start(),
      deadLetterWorker.start()
    ]);
    
    logger.info('All workers started successfully!');
  } catch (error) {
    logger.error('Error starting workers:', { error });
    process.exit(1);
  }
}

runWorkerDemo().catch(err => {
  logger.error('Unhandled error in worker demo:', { error: err });
  process.exit(1);
});
