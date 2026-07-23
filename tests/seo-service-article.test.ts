// tests/seo-service-article.test.ts — 부가서비스 글 (T-seo-service-article)
//
// 여기서 지키는 것:
//  1) ★ 원칙 2(마진 비공개) — 재료에도 프롬프트에도 **금액이 존재하지 않는다**.
//     옵션 JSON은 priceVnd·costVnd를 품고 있으므로 라벨만 뽑히는지 값으로 확인한다.
//  2) 카탈로그가 비거나 재료가 얇으면 글을 만들지 않는다(얇은 콘텐츠 방지)
//  3) 이미 쓴 서비스 주제는 다시 만들지 않는다(빌라·가이드와 동일 규칙)
import { describe, it, expect } from "vitest";
import { ServiceType } from "@prisma/client";
import {
  SERVICE_TOPICS,
  buildServiceFacts,
  hasEnoughServiceFacts,
  buildServiceArticlePrompt,
  pickServicePhotos,
  getServiceCandidates,
  serviceTopicByType,
  type ServiceItemRow,
} from "@/lib/seo/service-article";
import { normalizeTopicKeys } from "@/lib/seo/media";
import type { DbClient } from "@/lib/availability";

const item = (over: Partial<ServiceItemRow> & { type: ServiceType }): ServiceItemRow =>
  ({
    id: over.id ?? "c1",
    type: over.type,
    nameKo: over.nameKo ?? "발 마사지 60분",
    descKo: over.descKo ?? null,
    unitLabelKo: over.unitLabelKo ?? null,
    options: over.options ?? null,
    photoUrl: over.photoUrl ?? null,
  }) as ServiceItemRow;

/** 실제 카탈로그와 같은 모양 — 옵션 안에 금액이 들어 있다(이게 새면 안 된다) */
const OPTIONS_WITH_MONEY = {
  variants: [
    { key: "v60", labelKo: "60분", priceVnd: "450000", costVnd: "300000" },
    { key: "v90", labelKo: "90분", priceVnd: "650000", costVnd: "430000" },
  ],
  addons: [{ key: "a1", labelKo: "핫스톤 추가", priceVnd: "150000", costVnd: "90000" }],
  modifiers: [{ key: "m1", labelKo: "빌라 방문", priceVnd: "100000", costVnd: "50000" }],
};

describe("★ 금액 비노출 (원칙 2)", () => {
  const items = [
    item({
      type: ServiceType.MASSAGE,
      nameKo: "아로마 바디 마사지",
      descKo: "빌라로 방문해 진행하는 아로마 오일 마사지입니다. 타월과 오일은 준비해 옵니다.",
      unitLabelKo: "1인",
      options: OPTIONS_WITH_MONEY,
    }),
  ];

  it("재료에 옵션 라벨만 담기고 금액은 사라진다", () => {
    const facts = buildServiceFacts(items);
    expect(facts.optionLabels).toEqual(["60분", "90분", "핫스톤 추가", "빌라 방문"]);
    const flat = JSON.stringify(facts);
    for (const money of ["450000", "650000", "300000", "150000", "90000", "priceVnd", "costVnd"]) {
      expect(flat).not.toContain(money);
    }
  });

  it("재료 객체에 금액 키 자체가 없다", () => {
    const facts = buildServiceFacts(items);
    expect(Object.keys(facts).sort()).toEqual(["descriptions", "names", "optionLabels", "units"]);
  });

  it("프롬프트에도 금액이 들어가지 않는다", () => {
    const topic = serviceTopicByType(ServiceType.MASSAGE)!;
    const prompt = buildServiceArticlePrompt(topic, buildServiceFacts(items));
    for (const money of ["450000", "650000", "300000"]) expect(prompt).not.toContain(money);
    expect(prompt).toContain("금액 표현 절대 금지");
    expect(prompt).toContain("핫스톤 추가"); // 라벨은 재료로 쓰인다
  });
});

describe("생성 조건", () => {
  const makeDb = (rows: ServiceItemRow[]) =>
    ({
      serviceCatalogItem: {
        findMany: async (args: { where: { type: { in: ServiceType[] } } }) =>
          rows.filter((r) => args.where.type.in.includes(r.type)),
      },
    }) as unknown as DbClient;

  it("카탈로그가 비면 후보 0 — 서비스 글 단계는 no-op다", async () => {
    expect(await getServiceCandidates(new Set(), makeDb([]))).toEqual([]);
  });

  it("이름만 있는 얇은 항목은 후보가 되지 않는다", async () => {
    const db = makeDb([item({ type: ServiceType.BBQ, nameKo: "BBQ" })]);
    expect(await getServiceCandidates(new Set(), db)).toEqual([]);
  });

  it("설명이 충분하면 후보가 된다", async () => {
    const db = makeDb([
      item({
        type: ServiceType.BBQ,
        nameKo: "통돼지 바베큐",
        descKo: "빌라 마당에서 진행하는 통돼지 바베큐입니다. 굽는 사람이 함께 와서 준비와 정리를 맡습니다.",
      }),
    ]);
    const out = await getServiceCandidates(new Set(), db);
    expect(out).toHaveLength(1);
    expect(out[0].topic.key).toBe("service-bbq");
  });

  it("이미 글이 있는 서비스 주제는 후보에서 빠진다", async () => {
    const db = makeDb([
      item({
        type: ServiceType.BBQ,
        descKo: "빌라 마당에서 진행하는 통돼지 바베큐입니다. 준비와 정리를 맡아서 합니다.",
      }),
    ]);
    expect(await getServiceCandidates(new Set(["service-bbq"]), db)).toEqual([]);
  });

  it("재료 하한 판정은 이름만으로는 통과하지 못한다", () => {
    expect(hasEnoughServiceFacts({ names: ["BBQ"], units: [], descriptions: [], optionLabels: [] })).toBe(false);
    expect(hasEnoughServiceFacts({ names: [], units: [], descriptions: ["아주 긴 설명"], optionLabels: [] })).toBe(false);
  });
});

describe("주제 키·사진", () => {
  it("모든 서비스 주제 키는 slug로 쓸 수 있는 형태다", () => {
    for (const t of SERVICE_TOPICS) expect(t.key).toMatch(/^service-[a-z-]+$/);
    expect(new Set(SERVICE_TOPICS.map((t) => t.key)).size).toBe(SERVICE_TOPICS.length);
  });

  it("자료 사진 태그로 서비스 주제를 쓸 수 있다", () => {
    expect(normalizeTopicKeys(["service-massage", "golf-trip", "service-없음"])).toEqual([
      "service-massage",
      "golf-trip",
    ]);
  });

  it("상품 사진은 중복 없이 alt와 함께 뽑힌다", () => {
    const topic = serviceTopicByType(ServiceType.FRUIT)!;
    const photos = pickServicePhotos(topic, [
      item({ type: ServiceType.FRUIT, id: "a", nameKo: "열대과일 바구니", photoUrl: "https://cdn.r2.dev/f1.jpg" }),
      item({ type: ServiceType.FRUIT, id: "b", nameKo: "과일 도시락", photoUrl: "https://cdn.r2.dev/f1.jpg" }), // 중복 URL
      item({ type: ServiceType.FRUIT, id: "c", nameKo: "망고 세트", photoUrl: null }), // 사진 없음
    ]);
    expect(photos).toEqual([
      { url: "https://cdn.r2.dev/f1.jpg", alt: "푸꾸옥 열대과일 바구니", caption: "열대과일 바구니" },
    ]);
  });
});
