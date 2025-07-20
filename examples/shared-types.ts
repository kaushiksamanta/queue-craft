/**
 * Shared event payload types for the example applications
 */
export interface ExampleEventPayloadMap {
  'user.created': {
    id: string
    name: string
    email: string
    createdAt: string
  }
  'user.updated': {
    id: string
    name?: string
    email?: string
    updatedAt: string
  }
  'order.placed': {
    id: string
    userId: string
    items: Array<{
      productId: string
      quantity: number
      price: number
    }>
    total: number
    placedAt: string
  }
  'order.shipped': {
    id: string
    trackingNumber: string
    shippedAt: string
  }
  'notification.send': {
    type: 'email' | 'sms' | 'push'
    recipient: string
    subject?: string
    content: string
    metadata?: Record<string, any>
  }
  'notification.email': {
    recipient: string
    subject: string
    content: string
    metadata?: Record<string, any>
  }
  'notification.sms': {
    phoneNumber: string
    content: string
    metadata?: Record<string, any>
  }
  // Allow dead letter event for DLQ worker
  'dead-letter': any
}
