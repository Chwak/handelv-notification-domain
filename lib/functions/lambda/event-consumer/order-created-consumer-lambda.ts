import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import type { SQSEvent } from 'aws-lambda';

const NOTIFICATIONS_TABLE_NAME = process.env.NOTIFICATIONS_TABLE_NAME || '';
const OUTBOX_TABLE_NAME = process.env.OUTBOX_TABLE_NAME || '';

interface OrderCreatedEvent {
  orderId: string;
  collectorUserId: string;
  makerUserId?: string;
  makerUserIds?: string[];
  totalAmount: number;
  currency: string;
  timestamp: string;
}

const dynamodbClient = new DynamoDBClient({});
const dynamodbDoc = DynamoDBDocumentClient.from(dynamodbClient);

export const handler = async (event: SQSEvent): Promise<{
  batchItemFailures: Array<{ itemIdentifier: string }>;
}> => {
  console.log('========== ORDER CREATED CONSUMER START (Notification Domain) ==========');

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


      const detail = eventBridgeEnvelope.detail as OrderCreatedEvent;
      if (!detail) {
        throw new Error('Missing detail in EventBridge envelope');
      }

      const { orderId, collectorUserId, totalAmount, currency } = detail;
      const makerUserIds = detail.makerUserIds ?? (detail.makerUserId ? [detail.makerUserId] : []);

      // Validate required fields
      if (!orderId || !collectorUserId || !totalAmount) {
        throw new Error(
          `Missing required fields: orderId=${orderId}, collectorUserId=${collectorUserId}, totalAmount=${totalAmount}`
        );
      }

      console.log('Order Created Event:', { orderId, makerCount: makerUserIds.length });

      // Create notification for collector: "Order Confirmation"
      const notificationId = `notification-${randomUUID()}`;
      const now = Date.now();

      const orderConfirmationNotification = {
        notificationId,
        orderId,
        recipientUserId: collectorUserId,
        recipientRole: 'collector',
        type: 'order.confirmation',
        title: `Order Confirmed #${orderId}`,
        message: `Your order has been confirmed. Total: $${(totalAmount / 100).toFixed(2)} ${currency}`,
        createdAt: now,
        read: false,
        data: {
          orderId,
          amount: totalAmount,
          currency,
        },
      };

      console.log('Creating order confirmation notification', { orderId });

      await dynamodbDoc.send(
        new PutCommand({
          TableName: NOTIFICATIONS_TABLE_NAME,
          Item: orderConfirmationNotification,
        })
      );

      console.log(`Order confirmation notification created: notificationId=${notificationId}`);

      // Create notifications for makers: "New Order"
      if (makerUserIds.length > 0) {
        for (const makerUserId of makerUserIds) {
          const makerNotificationId = `notification-${randomUUID()}`;

          const makerNotification = {
            notificationId: makerNotificationId,
            orderId,
            recipientUserId: makerUserId,
            recipientRole: 'maker',
            type: 'new.order',
            title: `New Order: ${orderId}`,
            message: `A customer has ordered items from your shop!`,
            createdAt: now,
            read: false,
            data: {
              orderId,
              amount: totalAmount,
            },
          };

          console.log('Creating maker notification', { orderId });

          await dynamodbDoc.send(
            new PutCommand({
              TableName: NOTIFICATIONS_TABLE_NAME,
              Item: makerNotification,
            })
          );
        }
      }

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
                collectorUserId,
                notificationType: 'order.confirmation',
                recipientCount: 1 + (makerUserIds?.length || 0),
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

      console.log(`✅ Order confirmation notifications sent: orderId=${orderId}`);
    } catch (err) {
      console.error(`❌ Error processing record ${messageId}:`, err);
      batchItemFailures.push({ itemIdentifier: record.messageId || messageId });
    }
  }

  console.log('========== ORDER CREATED CONSUMER END ==========');
  console.log(`Processed ${event.Records?.length || 0} records, ${batchItemFailures.length} failures`);

  return { batchItemFailures };
};
