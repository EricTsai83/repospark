type SerializableValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SerializableValue[]
  | { [key: string]: SerializableValue };

function normalizeScope(scope: string) {
  return scope.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'event';
}

function serializeError(error: unknown): SerializableValue {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'number' || typeof error === 'boolean' || error == null) {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return '[unserializable-error]';
  }
}

export function createOpaqueErrorId(scope: string) {
  const normalizedScope = normalizeScope(scope);
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `${normalizedScope}_${Date.now().toString(36)}_${randomSuffix}`;
}

export function logInfo(scope: string, event: string, details: Record<string, SerializableValue> = {}) {
  console.log(`[${scope}] ${event}`, details);
}

export function logWarn(scope: string, event: string, details: Record<string, SerializableValue> = {}) {
  console.warn(`[${scope}] ${event}`, details);
}

export function logErrorWithId(
  scope: string,
  event: string,
  error: unknown,
  details: Record<string, SerializableValue> = {},
) {
  const errorId = createOpaqueErrorId(scope);
  console.error(`[${scope}] ${event}`, {
    errorId,
    ...details,
    error: serializeError(error),
  });
  return errorId;
}
