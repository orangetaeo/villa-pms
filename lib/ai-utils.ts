// [SHARED-MODULE] from C:\Projects\_shared\templates\utility-modules.md §4 v1.x (AI 응답 JSON 추출기)
// LLM 응답에서 JSON을 5단계 전략으로 추출 — 파싱 실패 방지 (T3.1 Gemini OCR 소비)

export function extractJsonFromAIResponse<T>(rawText: string): T | null {
  const trimmed = rawText.trim();

  // 1: 전체가 JSON
  try {
    return JSON.parse(trimmed) as T;
  } catch {}

  // 2: ```json 코드 블록
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try {
      return JSON.parse(codeBlock[1].trim()) as T;
    } catch {}
  }

  // 3: 가장 큰 코드 블록
  const blocks: RegExpExecArray[] = [];
  const re = /```(?:json)?\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) blocks.push(m);
  if (blocks.length > 1) {
    const largest = blocks.reduce((a, b) => (a[1].length > b[1].length ? a : b));
    try {
      return JSON.parse(largest[1].trim()) as T;
    } catch {}
  }

  // 4: balanced braces
  const balanced = extractBalanced(trimmed);
  if (balanced) {
    try {
      return JSON.parse(balanced) as T;
    } catch {}
  }

  // 5: 첫 { ~ 마지막 }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1)) as T;
    } catch {}
  }

  return null;
}

function extractBalanced(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\") {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
