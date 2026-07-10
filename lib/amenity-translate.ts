// custom 비품 라벨 vi→ko 저장형 번역 (T-amenity-quantity-custom)
// 저장(POST/PUT/PATCH) 트랜잭션 커밋 **후** best-effort로 호출한다. Zalo captionTranslated 저장형 패턴 준용.
// 원칙: GEMINI 미설정·호출 실패 시 조용히 스킵 — 저장 응답 성공에 영향 없음(호출부에서 try/catch로 격리).
//   customLabelKo가 이미 있는 행은 재번역하지 않는다(멱등·비용). null=미번역으로 남고 ko 표면은 customLabel 폴백.
import { prisma } from "@/lib/prisma";
import { translateText } from "@/lib/gemini";

// 1회 호출당 번역 상한(비용·레이트리밋 보호). 카테고리당 10개 × 허용 카테고리라도 dedupe 후 상한 적용.
const MAX_LABELS_PER_CALL = 10;

/**
 * 해당 빌라의 custom 비품 중 `customLabelKo IS NULL`인 라벨을 vi→ko 번역해 저장한다.
 * - customLabel dedupe(동일 라벨은 1회만 번역, 여러 행 동시 갱신)
 * - translateText(label, "ko")를 Promise.allSettled로 병렬(최대 10건)
 * - 성공분만 updateMany로 customLabelKo 기록 (실패·무의미 번역은 스킵 → null 유지)
 * 예외를 던지지 않도록 내부 전체를 try/catch로 감싼다(호출부도 이중으로 감쌈).
 */
export async function translateVillaCustomAmenities(villaId: string): Promise<void> {
  try {
    const rows = await prisma.villaAmenity.findMany({
      where: { villaId, itemKey: "custom", customLabelKo: null },
      select: { customLabel: true },
    });
    // dedupe + 빈 값 제거 + 상한
    const labels = [
      ...new Set(
        rows
          .map((r) => r.customLabel?.trim())
          .filter((l): l is string => !!l && l.length > 0)
      ),
    ].slice(0, MAX_LABELS_PER_CALL);
    if (labels.length === 0) return;

    const results = await Promise.allSettled(labels.map((label) => translateText(label, "ko")));

    await Promise.all(
      results.map(async (res, i) => {
        if (res.status !== "fulfilled") return; // 개별 실패 — 스킵
        const ko = res.value.trim();
        // 빈 번역·원문과 동일(음역/미번역)은 저장하지 않음 — null 유지가 명확
        if (!ko || ko === labels[i]) return;
        await prisma.villaAmenity.updateMany({
          where: { villaId, itemKey: "custom", customLabel: labels[i], customLabelKo: null },
          data: { customLabelKo: ko },
        });
      })
    );
  } catch (err) {
    // 키 미설정·DB·네트워크 오류 — 조용히 스킵(로그만). 저장은 이미 커밋됨.
    console.warn("[amenity-translate] custom 라벨 번역 스킵:", (err as Error)?.message ?? err);
  }
}
