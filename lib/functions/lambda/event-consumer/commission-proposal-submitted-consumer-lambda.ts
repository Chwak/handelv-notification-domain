import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import type { SQSEvent } from 'aws-lambda';

const NOTIFICATIONS_TABLE_NAME = process.env.NOTIFICATIONS_TABLE_NAME || '';

const dynamodbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface ProposalSubmittedPayload {
  proposalId: string;
  makerId: string;
  collectorId: string;
  collectorDisplayName?: string;
  desiredMaterial?: string;
  submittedAt: string;
}

export const handler = async (event: SQSEvent): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> => {
  console.log('===== COMMISSION PROPOSAL SUBMITTED CONSUMER (Notification Domain) =====');

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  if (!NOTIFICATIONS_TABLE_NAME) {
    throw new Error('NOTIFICATIONS_TABLE_NAME not configured');
  }

  for (const record of event.Records ?? []) {
    const messageId = record.messageId ?? 'unknown';
    try {
      if (!record.body) throw new Error('Empty SQS message body');

      const envelope = JSON.parse(record.body);
      const detail = (envelope.detail ?? envelope) as ProposalSubmittedPayload;

      const { proposalId, makerId, collectorDisplayName, desiredMaterial } = detail;
      if (!proposalId || !makerId) {
        throw new Error(`Missing required fields: proposalId=${proposalId}, makerId=${makerId}`);
      }

      const notificationId = `notification-${randomUUID()}`;
      const now = Date.now();
      const patron = collectorDisplayName ?? 'A collector';
      const material = desiredMaterial ? ` for "${desiredMaterial}"` : '';

      await dynamodbDoc.send(
        new PutCommand({
          TableName: NOTIFICATIONS_TABLE_NAME,
          Item: {
            notificationId,
            userId: makerId,
            type: 'COMMISSION_PROPOSAL_RECEIVED',
            title: 'New Vision Brief received',
            message: `${patron} has submitted a commission proposal${material}. Review it in your Proposals queue.`,
            payload: JSON.stringify({ proposalId }),
            isRead: false,
            createdAt: new Date(now).toISOString(),
            expiresAt: Math.floor(now / 1000) + 30 * 24 * 60 * 60,
          },
        }),
      );

      console.log('Commission proposal notification created for maker', { makerId, proposalId });
    } catch (err) {
      console.error('Failed to process commission.proposal.submitted record', { messageId, err });
      batchItemFailures.push({ itemIdentifier: messageId });
    }
  }

  return { batchItemFailures };
};
