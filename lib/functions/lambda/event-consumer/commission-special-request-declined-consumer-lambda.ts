import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import type { SQSEvent } from 'aws-lambda';

const NOTIFICATIONS_TABLE_NAME = process.env.NOTIFICATIONS_TABLE_NAME || '';

const dynamodbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface SpecialRequestDeclinedPayload {
  specialRequestId: string;
  makerId: string;
  collectorId: string;
  newStatus: string;
  updatedAt: string;
}

export const handler = async (event: SQSEvent): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> => {
  console.log('===== COMMISSION SPECIAL REQUEST DECLINED CONSUMER (Notification Domain) =====');

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  if (!NOTIFICATIONS_TABLE_NAME) {
    throw new Error('NOTIFICATIONS_TABLE_NAME not configured');
  }

  for (const record of event.Records ?? []) {
    const messageId = record.messageId ?? 'unknown';
    try {
      if (!record.body) throw new Error('Empty SQS message body');

      const envelope = JSON.parse(record.body);
      const detail = (envelope.detail ?? envelope) as SpecialRequestDeclinedPayload;

      const { specialRequestId, collectorId } = detail;
      if (!specialRequestId || !collectorId) {
        throw new Error(`Missing required fields: specialRequestId=${specialRequestId}, collectorId=${collectorId}`);
      }

      const notificationId = `notification-${randomUUID()}`;
      const now = Date.now();

      await dynamodbDoc.send(
        new PutCommand({
          TableName: NOTIFICATIONS_TABLE_NAME,
          Item: {
            notificationId,
            userId: collectorId,
            type: 'COMMISSION_SPECIAL_REQUEST_DECLINED',
            title: 'Commission update',
            message: 'The Artisan is currently focused on other creations. Please check back when the kiln is open.',
            payload: JSON.stringify({ specialRequestId }),
            isRead: false,
            createdAt: new Date(now).toISOString(),
            expiresAt: Math.floor(now / 1000) + 30 * 24 * 60 * 60,
          },
        }),
      );

      console.log('Commission declined notification created for collector', { collectorId, specialRequestId });
    } catch (err) {
      console.error('Failed to process commission.special_request.declined record', { messageId, err });
      batchItemFailures.push({ itemIdentifier: messageId });
    }
  }

  return { batchItemFailures };
};
