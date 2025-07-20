import { QueueCraft } from '../../src'
import { ExampleEventPayloadMap } from '../shared-types'
import { v4 as uuidv4 } from 'uuid'
import { WinstonLogger, WinstonLoggerOptions } from '../../src/logger'
import winston from 'winston'

const createCustomWinstonLogger = (): WinstonLogger => {
  const logFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }: Record<string, any>) => {
      const metaString = Object.keys(meta).length ? JSON.stringify(meta) : ''
      return `[${timestamp}] ${level}: ${message} ${metaString}`
    }),
  )

  const options: WinstonLoggerOptions = {
    level: 'debug',
    transports: [
      new winston.transports.Console({
        format: logFormat,
      }),
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      }),
      new winston.transports.File({
        filename: 'logs/combined.log',
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      }),
    ],
  }

  return new WinstonLogger(options)
}

const logger = createCustomWinstonLogger()

const queueCraft = new QueueCraft<ExampleEventPayloadMap>({
  connection: {
    host: process.env.RABBITMQ_HOST || 'localhost',
    port: parseInt(process.env.RABBITMQ_PORT || '5672'),
    username: process.env.RABBITMQ_USERNAME || 'guest',
    password: process.env.RABBITMQ_PASSWORD || 'guest',
  },
  logger,
})

const publisher = queueCraft.createPublisher()

const runPublisherDemo = async () => {
  logger.info('Publisher service starting...')

  try {
    const userId = uuidv4()
    logger.info(`Publishing user.created event for user ${userId}`)
    await publisher.publish('user.created', {
      id: userId,
      name: 'John Doe',
      email: 'john.doe@example.com',
      createdAt: new Date().toISOString(),
    })

    await new Promise(resolve => setTimeout(resolve, 1000))

    logger.info(`Publishing user.updated event for user ${userId}`)
    await publisher.publish('user.updated', {
      id: userId,
      name: 'John Smith',
      updatedAt: new Date().toISOString(),
    })

    await new Promise(resolve => setTimeout(resolve, 1000))

    const orderId = uuidv4()
    logger.info(`Publishing order.placed event for order ${orderId}`)
    await publisher.publish('order.placed', {
      id: orderId,
      userId: userId,
      items: [
        {
          productId: 'prod-1',
          quantity: 2,
          price: 29.99,
        },
        {
          productId: 'prod-2',
          quantity: 1,
          price: 49.99,
        },
      ],
      total: 109.97,
      placedAt: new Date().toISOString(),
    })

    await new Promise(resolve => setTimeout(resolve, 1000))

    logger.info(`Publishing order.shipped event for order ${orderId}`)
    await publisher.publish('order.shipped', {
      id: orderId,
      trackingNumber: 'TRK-' + Math.floor(Math.random() * 1000000),
      shippedAt: new Date().toISOString(),
    })

    await new Promise(resolve => setTimeout(resolve, 1000))

    logger.info('Publishing notification.send event')
    await publisher.publish('notification.send', {
      type: 'email',
      recipient: 'john.doe@example.com',
      subject: 'Your order has shipped!',
      content: `Your order ${orderId} has been shipped and is on its way!`,
      metadata: {
        orderId,
        trackingNumber: 'TRK-' + Math.floor(Math.random() * 1000000),
      },
    })

    logger.info('All events published successfully')
  } catch (error) {
    logger.error('Error in publisher service:', { error })
  }
}

runPublisherDemo()
  .catch(console.error)
  .finally(() => {
    setTimeout(() => {
      queueCraft
        .close()
        .then(() => logger.info('Publisher service shut down gracefully'))
        .catch(error => logger.error('Error during shutdown', { error }))
        .finally(() => process.exit(0))
    }, 2000)
  })
