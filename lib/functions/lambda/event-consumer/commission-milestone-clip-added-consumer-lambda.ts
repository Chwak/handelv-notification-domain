import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import type { SQSEvent } from 'aws-lambda';

const NOTIFICATIONS_TABLE_NAME = process.env.NOTIFICATIONS_TABLE_NAME || '';

const dynamodbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface MilestoneClipAddedPayload {
  proposalId: string;
  makerId: string;
  collectorId: string;
  clipId: string;
  clipTitle: string;
  clipKey: string;
  addedAt: string;
}

export const handler = async (event: SQSEvent): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> => {
  console.log('===== COMMISSION MILESTONE CLIP ADDED CONSUMER (Notification Domain) =====');

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  if (!NOTIFICATIONS_TABLE_NAME) {
    throw new Error('NOTIFICATIONS_TABLE_NAME not configured');
  }

  for (const record of event.Records ?? []) {
    const messageId = record.messageId ?? 'unknown';
    try {
      if (!record.body) throw new Error('Empty SQS message body');

      const envelope = JSON.parse(record.body);
      const detail = (envelope.detail ?? envelope) as MilestoneClipAddedPayload;

      const { proposalId, collectorId, clipTitle } = detail;
      if (!proposalId || !collectorId) {
        throw new Error(`Missing required fields: proposalId=${proposalId}, collectorId=${collectorId}`);
      }

      const notificationId = `notification-${randomUUID()}`;
      const now = Date.now();
      const chapterLabel = clipTitle ? `"${clipTitle}"` : 'A new chapter';

      await dynamodbDoc.send(
        new PutCommand({
          TableName: NOTIFICATIONS_TABLE_NAME,
          Item: {
            notificationId,
            userId: collectorId,
            type: 'COMMISSION_MILESTONE_CLIP_ADDED',
            title: 'New chapter added to your Masterpiece',
            message: `${chapterLabel} has been added to your commissioned Masterpiece. Visit your Creation Portal to witness the latest chapter unfold.`,
            payload: JSON.stringify({ proposalId, clipTitle }),
            isRead: false,
            createdAt: new Date(now).toISOString(),
            expiresAt: Math.floor(now / 1000) + 30 * 24 * 60 * 60,
          },
        }),
      );

      console.log('Milestone clip notification created for collector', { collectorId, proposalId });
    } catch (err) {
      console.error('Failed to process commission.milestone.clip.added record', { messageId, err });
      batchItemFailures.push({ itemIdentifier: messageId });
    }
  }

  return { batchItemFailures };
};
