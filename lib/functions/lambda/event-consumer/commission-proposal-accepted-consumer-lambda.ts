import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import type { SQSEvent } from 'aws-lambda';

const NOTIFICATIONS_TABLE_NAME = process.env.NOTIFICATIONS_TABLE_NAME || '';

const dynamodbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface ProposalAcceptedPayload {
  proposalId: string;
  makerId: string;
  collectorId: string;
  newStatus: string;
  updatedAt: string;
}

export const handler = async (event: SQSEvent): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> => {
  console.log('===== COMMISSION PROPOSAL ACCEPTED CONSUMER (Notification Domain) =====');

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  if (!NOTIFICATIONS_TABLE_NAME) {
    throw new Error('NOTIFICATIONS_TABLE_NAME not configured');
  }

  for (const record of event.Records ?? []) {
    const messageId = record.messageId ?? 'unknown';
    try {
      if (!record.body) throw new Error('Empty SQS message body');

      const envelope = JSON.parse(record.body);
      const detail = (envelope.detail ?? envelope) as ProposalAcceptedPayload;

      const { proposalId, collectorId } = detail;
      if (!proposalId || !collectorId) {
        throw new Error(`Missing required fields: proposalId=${proposalId}, collectorId=${collectorId}`);
      }

      const notificationId = `notification-${randomUUID()}`;
      const now = Date.now();

      await dynamodbDoc.send(
        new PutCommand({
          TableName: NOTIFICATIONS_TABLE_NAME,
          Item: {
            notificationId,
            userId: collectorId,
            type: 'COMMISSION_PROPOSAL_ACCEPTED',
            title: 'Your commission has begun',
            message: 'The Artisan has accepted your Vision Brief. Your Masterpiece is now In Creation. Follow the journey in your Creation Portal.',
            payload: JSON.stringify({ proposalId }),
            isRead: false,
            createdAt: new Date(now).toISOString(),
            expiresAt: Math.floor(now / 1000) + 30 * 24 * 60 * 60,
          },
        }),
      );

      console.log('Commission accepted notification created for collector', { collectorId, proposalId });
    } catch (err) {
      console.error('Failed to process commission.proposal.accepted record', { messageId, err });
      batchItemFailures.push({ itemIdentifier: messageId });
    }
  }

  return { batchItemFailures };
};
