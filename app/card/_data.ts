// 온라인 디지털 명함 데이터 (villa-go.net/card/[id]) — T-online-namecard
// 공개 페이지: 인증 불필요(미들웨어 보호목록 외 → 자동 통과). 회사 공통 정보 + 개인 연락처.
// 인쇄 명함(design/namecard/)과 동일한 정보 원천이므로 값 변경 시 양쪽을 함께 갱신할 것.

export type CardId = "theo" | "dokyung" | "taejin";

export interface Person {
  id: CardId;
  nameEn: string; // 로마자 (대문자)
  nameKo: string; // 한글 · 별칭
  role: string;
  telDisp: string; // 표시용 (+84 79 949 3138)
  tel: string; // tel: 링크용 (+84799493138)
  zalo: string; // zalo.me/<번호>
  email: string;
}

export const PEOPLE: Record<CardId, Person> = {
  theo: {
    id: "theo",
    nameEn: "KIM HAKTAE",
    nameKo: "김학태 · Taeo",
    role: "Founder & CEO",
    telDisp: "+84 79 949 3138",
    tel: "+84799493138",
    zalo: "84799493138",
    email: "biz.villago@gmail.com",
  },
  dokyung: {
    id: "dokyung",
    nameEn: "LEE DOKYUNG",
    nameKo: "이도경",
    role: "Director",
    telDisp: "+84 33 798 0661",
    tel: "+84337980661",
    zalo: "84337980661",
    email: "revolej79@gmail.com",
  },
  taejin: {
    id: "taejin",
    nameEn: "KIM TAEJIN",
    nameKo: "김태진",
    role: "Director",
    telDisp: "+84 70 263 5421",
    tel: "+84702635421",
    zalo: "84702635421",
    email: "danangtrip@kakao.com",
  },
};

export const CARD_IDS: CardId[] = ["theo", "dokyung", "taejin"];

export function getPerson(id: string): Person | null {
  return (PEOPLE as Record<string, Person>)[id] ?? null;
}

// vCard 3.0 — 모바일에서 "연락처에 추가". 줄바꿈은 CRLF(RFC 6350 권장).
export function buildVCard(p: Person): string {
  const parts = p.nameEn.split(" ");
  const family = parts[0] ?? "";
  const given = parts.slice(1).join(" ");
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${family};${given};;;`,
    `FN:${p.nameEn}`,
    "ORG:Villa Go",
    `TITLE:${p.role}`,
    `TEL;TYPE=CELL,VOICE:${p.tel}`,
    `EMAIL;TYPE=WORK:${p.email}`,
    "URL:https://villa-go.net",
    `URL:https://zalo.me/${p.zalo}`,
    "X-SOCIALPROFILE;TYPE=instagram:https://instagram.com/biz.villago",
    "NOTE:Villa Go — Phu Quoc Premium Pool Villas",
    "END:VCARD",
  ];
  return lines.join("\r\n");
}
