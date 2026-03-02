import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import type { SQSEvent } from 'aws-lambda';

const NOTIFICATIONS_TABLE_NAME = process.env.NOTIFICATIONS_TABLE_NAME || '';
const OUTBOX_TABLE_NAME = process.env.OUTBOX_TABLE_NAME || '';

interface StockHold {
  holdId: string;
  shelfItemId: string;
  quantity: number;
  makerUserId: string;
}

interface OrderStockConfirmedEvent {
  orderId: string;
  holds: StockHold[];
  paymentId: string;
  timestamp: string;
}

const dynamodbClient = new DynamoDBClient({});
const dynamodbDoc = DynamoDBDocumentClient.from(dynamodbClient);

export const handler = async (event: SQSEvent): Promise<{
  batchItemFailures: Array<{ itemIdentifier: string }>;
}> => {
  console.log('========== ORDER STOCK CONFIRMED CONSUMER START (Notification Domain) ==========');

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  if (!NOTIFICATIONS_TABLE_NAME) {
    console.error('NOTIFICATIONS_TABLE_NAME not set');
    throw new Error('Internal server error');
  }

  if (!OUTBOX_TABLE_NAME) {
    console.error('OUTBOX_TABLE_NAME not set');
    throw new Error('Internal server error');
  }

  for (const record of event.Records || []) {
    const messageId = record.messageId || 'unknown';
    try {
      console.log(`\n---------- Processing Record: ${messageId} ----------`);

      if (!record.body) {
        throw new Error('Empty SQS message body');
      }

      // Parse SQS message (wrapped EventBridge event)
      let eventBridgeEnvelope;
      try {
        eventBridgeEnvelope = JSON.parse(record.body);
      } catch (e) {
        console.error('Failed to parse SQS body as JSON', { messageId });
        throw e;
      }


      const detail = eventBridgeEnvelope.detail as OrderStockConfirmedEvent;
      if (!detail) {
        throw new Error('Missing detail in EventBridge envelope');
      }

      const { orderId, paymentId, holds } = detail;

      // Validate required fields
      if (!orderId || !paymentId || !holds || holds.length === 0) {
        throw new Error(
          `Missing required fields: orderId=${orderId}, paymentId=${paymentId}, holds=${holds?.length || 0}`
        );
      }

      console.log('Order Stock Confirmed Event:', { orderId, holdCount: holds.length });

      // Create notifications for each maker: "New Order to Fulfill"
      const makerIds = Array.from(new Set(holds.map(h => h.makerUserId)));
      const now = Date.now();

      for (const makerUserId of makerIds) {
        const makerHolds = holds.filter(h => h.makerUserId === makerUserId);
        const notificationId = `notification-${randomUUID()}`;

        const makerNotification = {
          notificationId,
          orderId,
          paymentId,
          recipientUserId: makerUserId,
          recipientRole: 'maker',
          type: 'order.fulfillment',
          title: `Order Ready to Fulfill: ${orderId}`,
          message: `Payment confirmed for your order! You have ${makerHolds.length} item(s) to prepare for shipment.`,
          createdAt: now,
          read: false,
          data: {
            orderId,
            paymentId,
            itemCount: makerHolds.length,
            items: makerHolds.map(h => ({
              shelfItemId: h.shelfItemId,
              quantity: h.quantity,
            })),
          },
        };

        console.log('Creating maker fulfillment notification', { orderId });

        await dynamodbDoc.send(
          new PutCommand({
            TableName: NOTIFICATIONS_TABLE_NAME,
            Item: makerNotification,
          })
        );
      }

      console.log(`Created notifications for ${makerIds.length} makers`);

      // Publish notification.sent.v1 event to outbox (for audit trail)
      try {
        console.log('Publishing notification.sent.v1 event to outbox...');
        const eventId = randomUUID();
        const timestamp = new Date().toISOString();
        const ttl = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days

        await dynamodbDoc.send(
          new PutCommand({
            TableName: OUTBOX_TABLE_NAME,
            Item: {
              eventId,
              eventType: 'notification.sent.v1',
              eventVersion: 1,
              correlationId: orderId,
              payload: JSON.stringify({
                orderId,
                paymentId,
                notificationType: 'order.fulfillment',
                makerCount: makerIds.length,
                holdCount: holds.length,
                timestamp,
              }),
              status: 'PENDING',
              createdAt: timestamp,
              retries: 0,
              expiresAt: ttl,
            },
          })
        );

        console.log('Published notification.sent.v1 event to outbox:', eventId);
      } catch (err) {
        console.error('Failed to publish notification event to outbox', { err });
        // Non-fatal, continue anyway
      }

      console.log(`✅ Maker fulfillment notifications sent: orderId=${orderId}, makerCount=${makerIds.length}`);
    } catch (err) {
      console.error(`❌ Error processing record ${messageId}:`, err);
      batchItemFailures.push({ itemIdentifier: record.messageId || messageId });
    }
  }

  console.log('========== ORDER STOCK CONFIRMED CONSUMER END ==========');
  console.log(`Processed ${event.Records?.length || 0} records, ${batchItemFailures.length} failures`);

  return { batchItemFailures };
};
