import { describe, it, expect } from "vitest";
import { PhotoSpace } from "@prisma/client";
import { selectDiversePhotos, type VillaPhotoRow } from "@/lib/instagram/draft";

function ph(space: PhotoSpace, i: number): VillaPhotoRow {
  return { id: `${space}-${i}`, url: `u/${space}-${i}.jpg`, space, sortOrder: i };
}
const countSpace = (out: VillaPhotoRow[], s: PhotoSpace) => out.filter((p) => p.space === s).length;

describe("selectDiversePhotos — 공간당 1장 우선(중복 침실 방지)", () => {
  it("침실 4장 + 5개 공간 → 침실은 1장만(실측 버그 케이스)", () => {
    const photos = [
      ph(PhotoSpace.EXTERIOR, 0),
      ph(PhotoSpace.LIVING, 0),
      ph(PhotoSpace.BEDROOM, 0),
      ph(PhotoSpace.BEDROOM, 1),
      ph(PhotoSpace.BEDROOM, 2),
      ph(PhotoSpace.BEDROOM, 3),
      ph(PhotoSpace.KITCHEN, 0),
      ph(PhotoSpace.BATHROOM, 0),
    ];
    const out = selectDiversePhotos(photos);
    expect(countSpace(out, PhotoSpace.BEDROOM)).toBe(1); // 침실 여러 장 방지
    expect(out.length).toBe(5); // 5개 공간 = 5장(≥ minCount 4라 2라운드 안 감)
    expect(new Set(out.map((p) => p.id)).size).toBe(out.length); // 같은 사진 중복 없음
  });

  it("공간 7개 이상 → 각 1장씩 최대 7장, 모두 다른 공간", () => {
    const photos = [
      ph(PhotoSpace.EXTERIOR, 0),
      ph(PhotoSpace.POOL, 0),
      ph(PhotoSpace.LIVING, 0),
      ph(PhotoSpace.BEDROOM, 0),
      ph(PhotoSpace.BEDROOM, 1),
      ph(PhotoSpace.KITCHEN, 0),
      ph(PhotoSpace.BATHROOM, 0),
      ph(PhotoSpace.BALCONY, 0),
      ph(PhotoSpace.ETC, 0),
    ];
    const out = selectDiversePhotos(photos);
    expect(out.length).toBe(7);
    expect(countSpace(out, PhotoSpace.BEDROOM)).toBe(1);
  });

  it("최소 장수 미달 시에만 2번째 사진 추가(침실만 5장 → 4장 채움)", () => {
    const photos = [0, 1, 2, 3, 4].map((i) => ph(PhotoSpace.BEDROOM, i));
    const out = selectDiversePhotos(photos);
    expect(out.length).toBe(4); // minCount까지 불가피하게 채움
  });

  it("사진이 minCount 미만이면 있는 만큼만", () => {
    const photos = [ph(PhotoSpace.EXTERIOR, 0), ph(PhotoSpace.LIVING, 0)];
    const out = selectDiversePhotos(photos);
    expect(out.length).toBe(2);
  });
});
