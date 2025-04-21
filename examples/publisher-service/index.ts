import { QueueCraft } from '../../src';
import { ExampleEventPayloadMap } from '../shared-types';
import { v4 as uuidv4 } from 'uuid';

// Each QueueCraft instance is type-safe for a single payload map.
// To use a different event map, create a new QueueCraft instance.
// All instances share the same RabbitMQ connection by default.
// Create a QueueCraft instance with our event payload map
const queueCraft = new QueueCraft<ExampleEventPayloadMap>({
  connection: {
    host: process.env.RABBITMQ_HOST || 'localhost',
    port: parseInt(process.env.RABBITMQ_PORT || '5672'),
    username: process.env.RABBITMQ_USERNAME || 'guest',
    password: process.env.RABBITMQ_PASSWORD || 'guest',
  },
});

// Create a publisher
const publisher = queueCraft.createPublisher();

async function runPublisherDemo() {
  console.log('Publisher service starting...');

  try {
    // Publish a user.created event
    const userId = uuidv4();
    console.log(`Publishing user.created event for user ${userId}`);
    await publisher.publish('user.created', {
      id: userId,
      name: 'John Doe',
      email: 'john.doe@example.com',
      createdAt: new Date().toISOString(),
    });

    // Wait a bit before publishing the next event
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Publish a user.updated event
    console.log(`Publishing user.updated event for user ${userId}`);
    await publisher.publish('user.updated', {
      id: userId,
      name: 'John Smith',
      updatedAt: new Date().toISOString(),
    });

    // Wait a bit before publishing the next event
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Publish an order.placed event
    const orderId = uuidv4();
    console.log(`Publishing order.placed event for order ${orderId}`);
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
    });

    // Wait a bit before publishing the next event
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Publish an order.shipped event
    console.log(`Publishing order.shipped event for order ${orderId}`);
    await publisher.publish('order.shipped', {
      id: orderId,
      trackingNumber: 'TRK-' + Math.floor(Math.random() * 1000000),
      shippedAt: new Date().toISOString(),
    });

    // Wait a bit before publishing the next event
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Publish a notification.send event
    console.log('Publishing notification.send event');
    await publisher.publish('notification.send', {
      type: 'email',
      recipient: 'john.doe@example.com',
      subject: 'Your order has shipped!',
      content: `Your order ${orderId} has been shipped and is on its way!`,
      metadata: {
        orderId,
        trackingNumber: 'TRK-' + Math.floor(Math.random() * 1000000),
      },
    });

    console.log('All events published successfully');
  } catch (error) {
    console.error('Error in publisher service:', error);
  }
}

// Run the demo
runPublisherDemo()
  .catch(console.error)
  .finally(() => {
    // Close the connection after a delay to ensure all messages are sent
    setTimeout(() => {
      queueCraft
        .close()
        .then(() => console.log('Publisher service shut down gracefully'))
        .catch(console.error)
        .finally(() => process.exit(0));
    }, 2000);
  });
