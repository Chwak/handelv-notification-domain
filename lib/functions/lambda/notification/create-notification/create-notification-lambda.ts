import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { randomUUID } from 'crypto';
import { requireAuthenticatedUser, validateId, validateNotificationType } from '../../../../utils/notification-validation';
import { initTelemetryLogger } from "../../../../utils/telemetry-logger";

const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE_NAME;
const NOTIFICATION_TOPIC_ARN = process.env.NOTIFICATION_TOPIC_ARN;

function parseEvent(event: unknown): {
  userId: string;
  type: string;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
  inApp?: boolean;
  email?: boolean;
  push?: boolean;
  sms?: boolean;
} | null {
  const raw = (event as { detail?: unknown; userId?: unknown; type?: unknown })?.detail ?? event;
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const userId = validateId(o.userId);
  const type = validateNotificationType(o.type);
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const message = typeof o.message === 'string' ? o.message.trim() : (typeof o.body === 'string' ? o.body.trim() : '');
  if (!userId || !type || !title || !message) return null;
  return {
    userId,
    type,
    title,
    message,
    payload: typeof o.payload === 'object' && o.payload !== null
      ? (o.payload as Record<string, unknown>)
      : (typeof o.metadata === 'object' && o.metadata !== null ? (o.metadata as Record<string, unknown>) : undefined),
    inApp: o.inApp === undefined ? true : Boolean(o.inApp),
    email: o.email === undefined ? true : Boolean(o.email),
    push: o.push === undefined ? true : Boolean(o.push),
    sms: o.sms === undefined ? false : Boolean(o.sms),
  };
}

export const handler = async (event: unknown & { headers?: Record<string, string>; identity?: any }) => {
  initTelemetryLogger(event, { domain: "notification-domain", service: "create-notification" });
  if (!NOTIFICATIONS_TABLE) {
    console.error('NOTIFICATIONS_TABLE_NAME is not configured');
    throw new Error('Internal server error');
  }

  const input = parseEvent(event);
  if (!input) throw new Error('Invalid input format');

  const authUserId = requireAuthenticatedUser(event as { identity?: any });
  if (!authUserId) throw new Error('Not authenticated');
  if (authUserId !== input.userId) throw new Error('Forbidden');

  const notificationId = randomUUID();
  const createdAt = new Date().toISOString();

  const item = {
    userId: input.userId,
    notificationId,
    type: input.type,
    title: input.title,
    message: input.message,
    createdAt,
    inApp: input.inApp,
    email: input.email,
    push: input.push,
    sms: input.sms,
    ...(input.payload && Object.keys(input.payload).length > 0 ? { payload: input.payload } : {}),
  };

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  await client.send(
    new PutCommand({
      TableName: NOTIFICATIONS_TABLE,
      Item: item,
    })
  );

  if (NOTIFICATION_TOPIC_ARN) {
    const sns = new SNSClient({});
    await sns.send(
      new PublishCommand({
        TopicArn: NOTIFICATION_TOPIC_ARN,
        Message: JSON.stringify({
          userId: input.userId,
          notificationId,
          type: input.type,
          title: input.title,
          message: input.message,
          createdAt,
          channels: { inApp: input.inApp, email: input.email, push: input.push, sms: input.sms },
        }),
      })
    );
  }

  return {
    notificationId,
    userId: input.userId,
    type: input.type,
    createdAt,
    channels: { inApp: input.inApp, email: input.email, push: input.push, sms: input.sms },
  };
};