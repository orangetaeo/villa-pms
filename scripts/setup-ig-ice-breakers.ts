// scripts/setup-ig-ice-breakers.ts — Instagram Ice Breakers(대화 시작 질문) 설정
//
//   실행(드라이런, 아무것도 전송 안 함):  npx tsx scripts/setup-ig-ice-breakers.ts
//   실제 적용(Graph API 호출):            npx tsx scripts/setup-ig-ice-breakers.ts --confirm
//
// Ice Breakers = 사용자가 우리 계정 DM 창을 처음 열 때 표시되는 정형 질문 버튼.
//   버튼을 누르면 payload가 messaging 웹훅으로 들어오고(웹훅 라우트가 텍스트처럼 처리),
//   자동응답(카카오 유도)이 이어진다. 3종: 예약 문의 / 가격 문의 / 부가서비스 문의.
//
// ★ 규율: 실행은 운영 판단(테오) — 이 스크립트는 "준비"만. --confirm 없이는 payload만 출력.
//   토큰은 AppSetting(IG_ACCESS_TOKEN)에서 복호화 — 값은 로그에 출력하지 않는다.
import {
  getIgAccessToken,
  getIgUserId,
  getIgGraphBase,
} from "@/lib/instagram/settings";

const ICE_BREAKERS = [
  { question: "예약 문의", payload: "ICEBREAKER_BOOKING" },
  { question: "가격 문의", payload: "ICEBREAKER_PRICING" },
  { question: "부가서비스 문의", payload: "ICEBREAKER_SERVICE" },
];

async function main() {
  const confirm = process.argv.includes("--confirm");

  const [token, userId, base] = await Promise.all([
    getIgAccessToken(),
    getIgUserId(),
    getIgGraphBase(),
  ]);

  const body = {
    platform: "instagram",
    ice_breakers: [{ locale: "default", call_to_actions: ICE_BREAKERS }],
  };

  console.log("=== Instagram Ice Breakers ===");
  console.log("질문 3종:", ICE_BREAKERS.map((b) => b.question).join(" / "));
  console.log("엔드포인트:", userId ? `${base}/${userId}/messenger_profile` : "(IG_USER_ID 미설정)");
  console.log("payload:", JSON.stringify(body, null, 2));

  if (!confirm) {
    console.log("\n[드라이런] --confirm 없이 실행됨 — 전송하지 않았습니다.");
    console.log("실제 적용: npx tsx scripts/setup-ig-ice-breakers.ts --confirm");
    return;
  }

  if (!token) throw new Error("IG_ACCESS_TOKEN 미설정 — 먼저 토큰을 저장하세요.");
  if (!userId) throw new Error("IG_USER_ID 미설정 — 먼저 IG 계정 id를 저장하세요.");

  const res = await fetch(
    `${base}/${userId}/messenger_profile?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok || json.error) {
    throw new Error(`Ice Breakers 설정 실패: ${json.error?.message ?? `HTTP ${res.status}`}`);
  }
  console.log("\n✔ Ice Breakers 적용 완료:", JSON.stringify(json));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("실패:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
