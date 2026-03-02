import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { validateId } from '../../../../utils/notification-validation';
import { initTelemetryLogger } from "../../../../utils/telemetry-logger";

const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE_NAME;
const NOTIFICATION_PREFERENCES_TABLE = process.env.NOTIFICATION_PREFERENCES_TABLE_NAME;
const NOTIFICATION_TOPIC_ARN = process.env.NOTIFICATION_TOPIC_ARN;

function parseEvent(event: unknown): { userId: string; notificationId: string } | null {
  const raw = (event as { detail?: unknown; userId?: unknown; notificationId?: unknown })?.detail ?? event;
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const userId = validateId(o.userId);
  const notificationId = validateId(o.notificationId);
  if (!userId || !notificationId) return null;
  return { userId, notificationId };
}

export const handler = async (event: unknown) => {
  initTelemetryLogger(event, { domain: "notification-domain", service: "deliver-notification" });
  if (!NOTIFICATIONS_TABLE || !NOTIFICATION_PREFERENCES_TABLE) {
    console.error('Table names are not configured');
    throw new Error('Internal server error');
  }

  const input = parseEvent(event);
  if (!input) throw new Error('Invalid input format');

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const getResult = await client.send(
    new GetCommand({
      TableName: NOTIFICATIONS_TABLE,
      Key: { userId: input.userId, notificationId: input.notificationId },
    })
  );
  const notification = getResult.Item as Record<string, unknown> | undefined;
  if (!notification) throw new Error('Notification not found');

  const notifType = (notification.type as string) ?? '';
  const prefsResult = await client.send(
    new GetCommand({
      TableName: NOTIFICATION_PREFERENCES_TABLE,
      Key: { userId: input.userId, notificationType: notifType },
    })
  );
  const prefItem = prefsResult.Item as Record<string, unknown> | undefined;
  const inApp = prefItem?.inApp ?? notification.inApp ?? true;
  const email = prefItem?.email ?? notification.email ?? true;
  const push = prefItem?.push ?? notification.push ?? true;
  const sms = prefItem?.sms ?? notification.sms ?? false;

  const deliveredAt = new Date().toISOString();
  await client.send(
    new UpdateCommand({
      TableName: NOTIFICATIONS_TABLE,
      Key: { userId: input.userId, notificationId: input.notificationId },
      UpdateExpression:
        'SET deliveredAt = :dt, deliveryChannels = :ch',
      ExpressionAttributeValues: {
        ':dt': deliveredAt,
        ':ch': { inApp, email, push, sms },
      },
    })
  );

  if (NOTIFICATION_TOPIC_ARN) {
    const sns = new SNSClient({});
    await sns.send(
      new PublishCommand({
        TopicArn: NOTIFICATION_TOPIC_ARN,
        Message: JSON.stringify({
          event: 'NOTIFICATION_DELIVERED',
          userId: input.userId,
          notificationId: input.notificationId,
          channels: { inApp, email, push, sms },
          deliveredAt,
        }),
      })
    );
  }

  return {
    delivered: true,
    channels: { inApp, email, push, sms },
    deliveredAt,
  };
};