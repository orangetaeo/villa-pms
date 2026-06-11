// [SHARED-MODULE] from Nike src/lib/ai-utils.ts
/**
 * AI 응답에서 JSON을 안전하게 추출하는 유틸리티
 * 5가지 추출 전략을 순차 시도하여 파싱 성공률 극대화
 */

/**
 * AI 응답 텍스트에서 JSON을 추출하여 파싱
 * 전략 순서: raw → code block → 최대 code block → balanced braces → first/last brace
 */
export function extractJsonFromAIResponse<T>(rawText: string): T | null {
  const trimmed = rawText.trim();

  // 전략 1: 전체 텍스트가 JSON인 경우
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // continue
  }

  // 전략 2: 첫 번째 ```json ... ``` 코드 블록
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as T;
    } catch {
      // continue
    }
  }

  // 전략 3: 가장 큰 ``` 코드 블록 (여러 블록이 있는 경우)
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  const allCodeBlocks: RegExpExecArray[] = [];
  let cbMatch: RegExpExecArray | null;
  while ((cbMatch = codeBlockRegex.exec(trimmed)) !== null) {
    allCodeBlocks.push(cbMatch);
  }
  if (allCodeBlocks.length > 1) {
    const largest = allCodeBlocks.reduce((a, b) => (a[1].length > b[1].length ? a : b));
    try {
      return JSON.parse(largest[1].trim()) as T;
    } catch {
      // continue
    }
  }

  // 전략 4: balanced braces — 첫 { 부터 매칭되는 마지막 } 까지
  const balanced = extractBalancedJson(trimmed);
  if (balanced) {
    try {
      return JSON.parse(balanced) as T;
    } catch {
      // continue
    }
  }

  // 전략 5: 첫 번째 { 부터 마지막 } 까지 (가장 관대한 방식)
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
    } catch {
      // continue
    }
  }

  // 모든 전략 실패
  console.error("[ai-utils] JSON 추출 실패. rawText 앞 1000자:", trimmed.slice(0, 1000));
  return null;
}

/**
 * 중괄호 균형을 맞춰 JSON 객체를 추출
 */
function extractBalancedJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * 재시도 불가능한 에러인지 판별 (빌링, 인증 등)
 */
function isNonRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // 타임아웃 / 중단 — 재시도해도 같은 결과 (가장 흔한 실패 원인)
    if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("aborted"))
      return true;
    if (error.name === "AbortError" || error.name === "TimeoutError") return true;
    // Anthropic 크레딧 부족 / 인증 오류
    if (msg.includes("credit balance") || msg.includes("billing")) return true;
    if (msg.includes("invalid api key") || msg.includes("authentication")) return true;
    // HTTP 400 (bad request), 401, 403 — 재시도해도 복구 불가
    const statusMatch = msg.match(/\b(400|401|403)\b/);
    if (statusMatch) return true;
    // 환경변수 미설정
    if (msg.includes("설정되지 않았습니다")) return true;
  }
  // Anthropic SDK status code
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: number }).status;
    if (status === 400 || status === 401 || status === 403) return true;
  }
  return false;
}

/**
 * AI 호출을 최대 1회 재시도하는 래퍼 (지수 백오프)
 * 재시도 간격: 1초
 * 빌링/인증 에러는 즉시 fallback 반환 (재시도 불필요)
 */
export async function withRetry<T>(fn: () => Promise<T>, fallback: T, label: string): Promise<T> {
  const MAX_RETRIES = 1;
  const BASE_DELAY_MS = 1000;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // 빌링/인증 에러는 재시도 불필요 — 즉시 종료
      if (isNonRetryableError(error)) {
        console.error(
          `[${label}] 재시도 불가능한 에러 (즉시 fallback):`,
          error instanceof Error ? error.message : error
        );
        return fallback;
      }

      if (attempt === MAX_RETRIES) {
        console.error(`[${label}] ${MAX_RETRIES}회 재시도 후 최종 실패:`, error);
        return fallback;
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`[${label}] 시도 ${attempt + 1} 실패, ${delay}ms 후 재시도...`, error);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return fallback; // unreachable, but TypeScript needs it
}
