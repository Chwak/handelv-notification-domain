import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import type { SQSEvent } from 'aws-lambda';

const NOTIFICATIONS_TABLE_NAME = process.env.NOTIFICATIONS_TABLE_NAME || '';
const OUTBOX_TABLE_NAME = process.env.OUTBOX_TABLE_NAME || '';

interface OrderPaidEvent {
  orderId: string;
  collectorUserId: string;
  paymentId: string;
  amount: number;
  currency: string;
  timestamp: string;
}

const dynamodbClient = new DynamoDBClient({});
const dynamodbDoc = DynamoDBDocumentClient.from(dynamodbClient);

export const handler = async (event: SQSEvent): Promise<{
  batchItemFailures: Array<{ itemIdentifier: string }>;
}> => {
  console.log('========== ORDER PAID CONSUMER START (Notification Domain) ==========');

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


      const detail = eventBridgeEnvelope.detail as OrderPaidEvent;
      if (!detail) {
        throw new Error('Missing detail in EventBridge envelope');
      }

      const { orderId, collectorUserId, paymentId, amount, currency } = detail;

      // Validate required fields
      if (!orderId || !collectorUserId || !paymentId || !amount) {
        throw new Error(
          `Missing required fields: orderId=${orderId}, collectorUserId=${collectorUserId}, paymentId=${paymentId}, amount=${amount}`
        );
      }

      console.log('Order Paid Event:', { orderId, paymentId });

      // Create notification for collector: "Payment Receipt"
      const notificationId = `notification-${randomUUID()}`;
      const now = Date.now();

      const paymentReceiptNotification = {
        notificationId,
        orderId,
        paymentId,
        recipientUserId: collectorUserId,
        recipientRole: 'collector',
        type: 'payment.receipt',
        title: `Payment Received #${orderId}`,
        message: `Payment of $${(amount / 100).toFixed(2)} ${currency} has been confirmed. Your order will be prepared for shipment.`,
        createdAt: now,
        read: false,
        data: {
          orderId,
          paymentId,
          amount,
          currency,
        },
      };

      console.log('Creating payment receipt notification', { orderId, paymentId });

      await dynamodbDoc.send(
        new PutCommand({
          TableName: NOTIFICATIONS_TABLE_NAME,
          Item: paymentReceiptNotification,
        })
      );

      console.log(`Payment receipt notification created: notificationId=${notificationId}`);

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
                collectorUserId,
                notificationType: 'payment.receipt',
                amount,
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

      console.log(`✅ Payment receipt notification sent: orderId=${orderId}, paymentId=${paymentId}`);
    } catch (err) {
      console.error(`❌ Error processing record ${messageId}:`, err);
      batchItemFailures.push({ itemIdentifier: record.messageId || messageId });
    }
  }

  console.log('========== ORDER PAID CONSUMER END ==========');
  console.log(`Processed ${event.Records?.length || 0} records, ${batchItemFailures.length} failures`);

  return { batchItemFailures };
};
