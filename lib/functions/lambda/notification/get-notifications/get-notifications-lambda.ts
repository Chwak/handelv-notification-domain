import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { initTelemetryLogger } from "../../../../utils/telemetry-logger";
import {
  encodeNextToken,
  parseNextToken,
  requireAuthenticatedUser,
  validateId,
  validateLimit,
  validateNotificationType,
} from '../../../../utils/notification-validation';

const TABLE_NAME = process.env.NOTIFICATIONS_TABLE_NAME;

interface GetNotificationsArgs {
  userId?: unknown;
  unreadOnly?: unknown;
  type?: unknown;
  limit?: unknown;
  nextToken?: unknown;
}

interface AppSyncEvent {
  arguments?: GetNotificationsArgs;
  identity?: any;
}

export const handler = async (event: AppSyncEvent) => {
  initTelemetryLogger(event, { domain: "notification-domain", service: "get-notifications" });

  if (!TABLE_NAME) {
    console.error('NOTIFICATIONS_TABLE_NAME is not configured');
    throw new Error('Internal server error');
  }

  const args = event.arguments || {};
  const userId = validateId(args.userId);
  if (!userId) {
    throw new Error('Invalid input format');
  }

  const authUserId = requireAuthenticatedUser(event);
  if (!authUserId) {
    throw new Error('Not authenticated');
  }
  if (authUserId !== userId) {
    throw new Error('Forbidden');
  }

  const unreadOnly = args.unreadOnly === undefined ? false : Boolean(args.unreadOnly);
  const type = args.type ? validateNotificationType(args.type) : null;
  if (args.type && !type) {
    throw new Error('Invalid input format');
  }

  const limit = validateLimit(args.limit, 20, 100);
  const startKey = parseNextToken(args.nextToken);

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  try {
    const queryInput: any = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: {
        ':uid': userId,
      },
      Limit: limit,
      ExclusiveStartKey: startKey,
      ScanIndexForward: false, // most recent first by sort key (notificationId or createdAt-embedded)
    };

    if (unreadOnly || type) {
      const filters: string[] = [];
      if (unreadOnly) {
        filters.push('attribute_not_exists(readAt)');
      }
      if (type) {
        filters.push('#type = :type');
        queryInput.ExpressionAttributeNames = { ...(queryInput.ExpressionAttributeNames || {}), '#type': 'type' };
        queryInput.ExpressionAttributeValues[':type'] = type;
      }
      queryInput.FilterExpression = filters.join(' AND ');
    }

    const result = await client.send(new QueryCommand(queryInput));

    const items = result.Items ?? [];
    const next = encodeNextToken(result.LastEvaluatedKey as Record<string, unknown> | undefined);

    const unreadCount = items.filter((n) => !('readAt' in n) || n.readAt == null).length;

    return {
      items,
      nextToken: next,
      unreadCount,
    };
  } catch (err) {
    console.error('getNotifications error:', err);
    throw new Error('Failed to get notifications');
  }
};
