import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { initTelemetryLogger } from "../../../../utils/telemetry-logger";
import {
  NOTIFICATION_TYPES,
  requireAuthenticatedUser,
  validateId,
  validateNotificationType,
} from '../../../../utils/notification-validation';


const PREFS_TABLE_NAME = process.env.NOTIFICATION_PREFERENCES_TABLE_NAME;

type NotificationChannelPrefs = {
  inApp?: boolean | null;
  email?: boolean | null;
  push?: boolean | null;
  sms?: boolean | null;
};

interface NotificationTypePreferenceInput extends NotificationChannelPrefs {
  type?: unknown;
}

interface UpdateNotificationPreferencesInput {
  userId?: unknown;
  preferences?: NotificationTypePreferenceInput[] | null;
}

interface AppSyncEvent {
  arguments?: {
    input?: UpdateNotificationPreferencesInput;
  };
  identity?: any;
  headers?: Record<string, string>;
}

function normalizePreference(input: NotificationTypePreferenceInput): { notificationType: string } & Required<NotificationChannelPrefs> {
  const type = validateNotificationType(input.type);
  if (!type) {
    throw new Error('Invalid input format');
  }

  const inApp = input.inApp ?? true;
  const email = input.email ?? true;
  const push = input.push ?? true;
  const sms = input.sms ?? false;

  if (![inApp, email, push, sms].some(Boolean)) {
    throw new Error('Validation failed');
  }

  return {
    notificationType: type,
    inApp,
    email,
    push,
    sms,
  };
}

export const handler = async (event: AppSyncEvent) => {
  initTelemetryLogger(event, { domain: "notification-domain", service: "update-preferences" });

  if (!PREFS_TABLE_NAME) {
    console.error('NOTIFICATION_PREFERENCES_TABLE_NAME is not configured');
    throw new Error('Internal server error');
  }

  const input = (event.arguments?.input || {}) as UpdateNotificationPreferencesInput;
  const userId = validateId(input.userId);
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

  const prefs = input.preferences;
  if (!Array.isArray(prefs) || prefs.length === 0 || prefs.length > 50) {
    throw new Error('Validation failed');
  }

  const normalized: ReturnType<typeof normalizePreference>[] = [];
  const seenTypes = new Set<string>();
  for (const p of prefs) {
    const norm = normalizePreference(p);
    if (seenTypes.has(norm.notificationType)) {
      throw new Error('Validation failed');
    }
    seenTypes.add(norm.notificationType);
    normalized.push(norm);
  }

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  try {
    // Delete existing preferences for user
    const existing = await client.send(
      new QueryCommand({
        TableName: PREFS_TABLE_NAME,
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: {
          ':uid': userId,
        },
      }),
    );

    const existingItems = existing.Items ?? [];
    for (const item of existingItems) {
      await client.send(
        new DeleteCommand({
          TableName: PREFS_TABLE_NAME,
          Key: {
            userId,
            notificationType: item.notificationType,
          },
        }),
      );
    }

    // Write new preferences
    const writeRequests = normalized.map((p) => ({
      PutRequest: {
        Item: {
          userId,
          notificationType: p.notificationType,
          inApp: p.inApp,
          email: p.email,
          push: p.push,
          sms: p.sms,
        },
      },
    }));

    // Batch writes in chunks of 25
    for (let i = 0; i < writeRequests.length; i += 25) {
      const chunk = writeRequests.slice(i, i + 25);
      await client.send(
        new BatchWriteCommand({
          RequestItems: {
            [PREFS_TABLE_NAME]: chunk,
          },
        }),
      );
    }

    // Return normalized preferences as the new state
    return normalized.map((p) => ({
      type: p.notificationType,
      inApp: p.inApp,
      email: p.email,
      push: p.push,
      sms: p.sms,
    }));
  } catch (err) {
    console.error('updateNotificationPreferences error:', err);
    throw new Error('Failed to update notification preferences');
  }
};
