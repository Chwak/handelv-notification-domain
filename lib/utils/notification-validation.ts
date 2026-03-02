/**
 * Validation helpers for Notification Domain GraphQL lambdas.
 */

export function validateId(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (trimmed.length > 200) return null;
  return trimmed;
}

export function validateLimit(raw: unknown, defaultValue = 20, max = 100): number {
  if (raw == null) return defaultValue;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1) return defaultValue;
  return Math.min(n, max);
}

export function parseNextToken(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function encodeNextToken(key?: Record<string, unknown> | null): string | null {
  if (!key || Object.keys(key).length === 0) return null;
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

type ActiveMode = 'maker' | 'collector';
type RequiredMode = ActiveMode | 'both';
const REQUIRED_ACTIVE_MODE: RequiredMode = 'both';

function isEnabled(value: unknown): boolean {
  return value === true || value === 'true';
}

function resolveActiveMode(claims: Record<string, unknown> | undefined): ActiveMode | null {
  const rawMode = claims?.active_mode;
  if (rawMode === 'maker' || rawMode === 'collector') return rawMode;
  const makerEnabled = isEnabled(claims?.maker_enabled);
  const collectorEnabled = isEnabled(claims?.collector_enabled);
  if (makerEnabled !== collectorEnabled) return makerEnabled ? 'maker' : 'collector';
  if (makerEnabled && collectorEnabled) return 'maker';
  return null;
}

function isAuthorizedForMode(claims: Record<string, unknown> | undefined, required: RequiredMode): boolean {
  const activeMode = resolveActiveMode(claims);
  if (required === 'both') return activeMode !== null;
  return activeMode === required;
}

export function requireAuthenticatedUser(event: { identity?: any }, requiredMode: RequiredMode = REQUIRED_ACTIVE_MODE): string | null {
  const identity = event.identity;
  if (!identity) return null;
  const claims = identity.claims as Record<string, unknown> | undefined;
  if (!isAuthorizedForMode(claims, requiredMode)) return null;
  if (typeof identity.sub === 'string' && identity.sub.trim()) {
    return identity.sub.trim();
  }
  if (identity.claims && typeof identity.claims.sub === 'string') {
    return identity.claims.sub.trim();
  }
  return null;
}

export const NOTIFICATION_TYPES = new Set([
  'ORDER_CONFIRMED',
  'ORDER_SHIPPED',
  'ORDER_DELIVERED',
  'ORDER_CANCELED',
  'NEW_MESSAGE',
  'MESSAGE_REPLY',
  'REVIEW_RECEIVED',
  'REVIEW_APPROVED',
  'PRODUCT_FAVORITED',
  'NEW_PRODUCT_FROM_FOLLOWED_MAKER',
  'ACCOUNT_VERIFIED',
  'PAYOUT_COMPLETED',
] as const);

export function validateNotificationType(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!NOTIFICATION_TYPES.has(v as any)) return null;
  return v;
}

