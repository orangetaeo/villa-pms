// Railway 헬스체크 전용 — 인증 없이 200 반환 (루트 /는 role 리다이렉트라 헬스체크 불가)
export function GET() {
  return Response.json({ ok: true });
}
