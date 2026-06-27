import { describe, it, expect } from "vitest";
import { csvCell, csvRow, toCsv } from "./csv";

describe("csvCell — 수식 인젝션 차단 (보안 P0-7)", () => {
  it("= + - @ 로 시작하는 셀은 ' 선행으로 무력화한다", () => {
    // 위험 prefix → 앞에 ' 가 붙어 텍스트화. (단독으론 따옴표 래핑 불필요)
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+cmd|'/c calc'!A1")).toBe("'+cmd|'/c calc'!A1"); // ' 선행만(작은따옴표는 래핑 트리거 아님)
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(1)")).toBe("'@SUM(1)");
  });

  it("탭·CR 로 시작하는 셀도 무력화한다", () => {
    expect(csvCell("\t=evil")).toBe("'\t=evil"); // \t 시작 → ' 선행. \t는 RFC 래핑 트리거 아님
    expect(csvCell("\rX")).toBe(`"'\rX"`); // \r 시작 → ' 선행 + \r 포함이라 따옴표 래핑
  });

  it("정상 텍스트·숫자는 변형하지 않는다", () => {
    expect(csvCell("쏘나씨 V11")).toBe("쏘나씨 V11");
    expect(csvCell(242000)).toBe("242000");
    expect(csvCell("Nguyen Van A")).toBe("Nguyen Van A");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("쉼표·따옴표·개행은 RFC 4180대로 이스케이프한다", () => {
    expect(csvCell("a,b")).toBe(`"a,b"`);
    expect(csvCell('say "hi"')).toBe(`"say ""hi"""`);
    expect(csvCell("line1\nline2")).toBe(`"line1\nline2"`);
  });

  it("수식 prefix + 쉼표가 같이 있으면 ' 선행 후 따옴표 래핑", () => {
    expect(csvCell("=A,B")).toBe(`"'=A,B"`);
  });
});

describe("csvRow / toCsv", () => {
  it("행을 쉼표로 결합한다", () => {
    expect(csvRow(["a", 1, null, "=x"])).toBe("a,1,,'=x");
  });

  it("toCsv는 BOM + CRLF 결합", () => {
    const out = toCsv([["a", "b"], ["c", "=d"]]);
    expect(out).toBe("﻿a,b\r\nc,'=d");
  });

  it("toCsv BOM 끄기 가능", () => {
    expect(toCsv([["x"]], false)).toBe("x");
  });
});
