import { describe, it, expect } from "vitest";
import { reviveDumpBigInt, BIGINT_FIELDS_BY_MODEL } from "@/lib/snapshot-restore";

// P2-1 — dmmf가 BigInt로 선언한 필드에만 역변환. String 컬럼의 "123n" 값은 보존.
describe("reviveDumpBigInt (필드 인지 BigInt 역변환)", () => {
  it("Villa: BigInt 필드는 BigInt로, String name의 '123n'은 문자열 유지", () => {
    // monthlyRentVnd·baseDepositVnd=BigInt, name=String (dmmf 실측)
    const dump = {
      Villa: [
        {
          id: "v1",
          name: "123n", // String 컬럼에 우연히 BigInt처럼 보이는 값
          monthlyRentVnd: "1500000n",
          baseDepositVnd: "-5n", // 음수
          note: null,
        },
      ],
    };
    reviveDumpBigInt(dump);
    const row = dump.Villa[0] as Record<string, unknown>;
    expect(typeof row.name).toBe("string");
    expect(row.name).toBe("123n"); // 오변환 없음
    expect(row.monthlyRentVnd).toBe(1500000n);
    expect(row.baseDepositVnd).toBe(-5n);
    expect(row.note).toBeNull();
  });

  it("BigInt 필드가 null이면 그대로 null", () => {
    const dump = { Villa: [{ id: "v2", name: "x", monthlyRentVnd: null }] };
    reviveDumpBigInt(dump);
    expect((dump.Villa[0] as Record<string, unknown>).monthlyRentVnd).toBeNull();
  });

  it("BigInt 필드가 없는 모델은 무동작(문자열 보존)", () => {
    // dmmf에 존재하되 BigInt 스칼라가 없는 모델을 골라, '9n' 같은 값이 보존되는지 확인.
    const modelWithoutBigInt = [...BIGINT_FIELDS_BY_MODEL.entries()].find(
      ([, fields]) => fields.size === 0
    )?.[0];
    expect(modelWithoutBigInt).toBeTruthy();
    const dump = { [modelWithoutBigInt as string]: [{ id: "a", someText: "9n" }] };
    reviveDumpBigInt(dump);
    expect((dump[modelWithoutBigInt as string][0] as Record<string, unknown>).someText).toBe("9n");
  });

  it("알 수 없는 모델(스키마에 없는 키)은 건드리지 않음", () => {
    const dump = { NotAModel: [{ x: "123n" }] };
    reviveDumpBigInt(dump);
    expect((dump.NotAModel[0] as Record<string, unknown>).x).toBe("123n");
  });
});
