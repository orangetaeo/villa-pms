// [SHARED-MODULE] from Nike src/lib/zalo-debug.ts
/**
 * Debug buffer for raw Zalo messages.
 * Extracted from zalo-instance.ts to avoid circular dependencies with zalo-pool.ts.
 */

// ── Debug buffer for raw file messages ────────────────────────────
export interface DebugRawMessage {
  timestamp: number;
  threadId: string;
  msgId: string;
  rawData: Record<string, unknown>;
}

const globalForDebug = globalThis as unknown as {
  zaloDebugBuffer: DebugRawMessage[] | undefined;
};

function getDebugBuffer(): DebugRawMessage[] {
  if (!globalForDebug.zaloDebugBuffer) {
    globalForDebug.zaloDebugBuffer = [];
  }
  return globalForDebug.zaloDebugBuffer;
}

export function pushDebug(threadId: string, msgId: string, rawData: Record<string, unknown>) {
  const buf = getDebugBuffer();
  buf.push({ timestamp: Date.now(), threadId, msgId, rawData });
  if (buf.length > 50) buf.shift(); // keep last 50
}

export function getZaloDebugMessages(): DebugRawMessage[] {
  return getDebugBuffer();
}
