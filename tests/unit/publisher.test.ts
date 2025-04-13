import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionManager } from '../../src/connection';
import { Publisher, createPublisher } from '../../src/publisher';

// Mock ConnectionManager
vi.mock('../../src/connection', () => {
  const mockChannel = {
    publish: vi.fn().mockReturnValue(true),
  };

  const MockConnectionManager = vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    getChannel: vi.fn().mockResolvedValue(mockChannel),
    assertExchange: vi.fn().mockResolvedValue({ exchange: 'test-exchange' }),
    close: vi.fn().mockResolvedValue(undefined),
  }));

  return {
    ConnectionManager: MockConnectionManager,
  };
});

describe('Publisher', () => {
  let connectionManager: ConnectionManager;
  let publisher: Publisher;

  beforeEach(() => {
    connectionManager = new ConnectionManager({
      host: 'localhost',
      port: 5672,
      username: 'guest',
      password: 'guest',
    });

    publisher = new Publisher(connectionManager, 'test-exchange');
  });

  afterEach(async () => {
    await publisher.close();
  });

  it('should initialize publisher', async () => {
    await publisher.initialize();

    expect(connectionManager.connect).toHaveBeenCalled();
    expect(connectionManager.assertExchange).toHaveBeenCalledWith('test-exchange', undefined);
  });

  it('should publish event', async () => {
    const result = await publisher.publish('user.created', { id: '123', name: 'John' });

    const channel = await connectionManager.getChannel();

    expect(result).toBe(true);
    expect(channel.publish).toHaveBeenCalledWith(
      'test-exchange',
      'user.created',
      expect.any(Buffer),
      expect.objectContaining({
        contentType: 'application/json',
        contentEncoding: 'utf-8',
        persistent: true,
      }),
    );
  });

  it('should publish event with custom options', async () => {
    const messageId = '123456';
    const timestamp = Date.now();
    const headers = { source: 'test' };

    const result = await publisher.publish(
      'order.placed',
      { id: '456', amount: 100 },
      {
        messageId,
        timestamp,
        headers,
        contentType: 'application/custom',
        contentEncoding: 'gzip',
        persistent: false,
      },
    );

    const channel = await connectionManager.getChannel();

    expect(result).toBe(true);
    expect(channel.publish).toHaveBeenCalledWith(
      'test-exchange',
      'order.placed',
      expect.any(Buffer),
      expect.objectContaining({
        messageId,
        timestamp,
        headers,
        contentType: 'application/custom',
        contentEncoding: 'gzip',
        persistent: false,
      }),
    );
  });

  it('should create publisher with factory function', () => {
    const customPublisher = createPublisher(connectionManager, 'custom-exchange');

    expect(customPublisher).toBeInstanceOf(Publisher);
  });
});
