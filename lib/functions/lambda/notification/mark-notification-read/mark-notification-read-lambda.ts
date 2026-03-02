import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { initTelemetryLogger } from "../../../../utils/telemetry-logger";
import {
  requireAuthenticatedUser,
  validateId,
} from '../../../../utils/notification-validation';

function resolveTraceparent(event: { headers?: Record<string, string> }): string {
  const headerTraceparent = event.headers?.traceparent || event.headers?.Traceparent;
  const isValid = headerTraceparent && /^\d{2}-[0-9a-f]{32}-[0-9a-f]{16}-\d{2}$/i.test(headerTraceparent);
  if (isValid) return headerTraceparent;
  const traceId = randomUUID().replace(/-/g, '');
  const spanId = randomUUID().replace(/-/g, '').slice(0, 16);
  return `00-${traceId}-${spanId}-01`;
}

const TABLE_NAME = process.env.NOTIFICATIONS_TABLE_NAME;

interface AppSyncEvent {
  arguments?: {
    notificationId?: unknown;
  };
  identity?: any;
  headers?: Record<string, string>;
}

export const handler = async (event: AppSyncEvent) => {
  initTelemetryLogger(event, { domain: "notification-domain", service: "mark-notification-read" });
  const traceparent = resolveTraceparent(event);

  if (!TABLE_NAME) {
    console.error('NOTIFICATIONS_TABLE_NAME is not configured');
    throw new Error('Internal server error');
  }

  const args = event.arguments || {};
  const notificationId = validateId(args.notificationId);
  if (!notificationId) {
    throw new Error('Invalid notificationId format');
  }

  const authUserId = requireAuthenticatedUser(event);
  if (!authUserId) {
    throw new Error('Not authenticated');
  }

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  try {
    const existing = await client.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          userId: authUserId,
          notificationId,
        },
      }),
    );

    const item = existing.Item;
    if (!item) {
      throw new Error('Notification not found');
    }

    // Idempotent: if already read, this is a no-op update
    const now = new Date().toISOString();

    const result = await client.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          userId: authUserId,
          notificationId,
        },
        UpdateExpression: 'SET readAt = if_not_exists(readAt, :now)',
        ExpressionAttributeValues: {
          ':now': now,
        },
        ReturnValues: 'ALL_NEW',
      }),
    );

    return result.Attributes ?? item;
  } catch (err) {
    console.error('markNotificationRead error:', err);
    throw new Error('Failed to mark notification as read');
  }
};
