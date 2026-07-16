// lib/privacy-policy.ts — /privacy 개인정보처리방침 콘텐츠 (ko/en/vi 3개 언어)
//
// 설계: 공개 문서 페이지. next-intl 글로벌 설정(ko/vi)·messages/*.json을 건드리지 않고,
//   기존 다국어 딕셔너리 모듈 패턴(lib/public-i18n.ts·lib/agreement.ts)을 따라 자체 사전으로 둔다.
//   /privacy 서버 컴포넌트가 lang을 해석해 PRIVACY_POLICY[lang]를 렌더한다.
//
// ★사실 정합(임의 창작 금지): 여권 처리 서술은 ADR-0029 + lib/tamtru.ts 실동작에 정합한다.
//   - 여권 사진면 1장만 빌라 관리인(공급자) Zalo로 전달(임시거주신고 tạm trú 목적).
//   - 체크인 동의서 서명이 전제(제3자 전달 동의 필수 게이트).
//   - 이미 전달된 사본은 기술적으로 회수 불가(N5) — 정직하게 고지.
//   - 여권 90일 보존은 수동 운영 정책(자동 삭제 cron 미구현 — N1). 내부 구현 세부는 노출하지 않되
//     "목적 달성 후 파기" 원칙만 서술.
// ★법적 확정본 아님: 특정 법령·조문 번호를 창작하지 않는다(테오/법무 확인 전제). 하단 고지 명시.
// ★누수 방지: 판매가(KRW)·마진·공급자 원가·비공개 재고 관련 표현은 이 문서에 넣지 않는다.

export type PrivacyLang = "ko" | "en" | "vi";
export const PRIVACY_LANGS: PrivacyLang[] = ["ko", "en", "vi"];

/** /p·/privacy 공유 언어 쿠키(글로벌 locale 쿠키 ko/vi와 분리). ru/zh 값이 오면 ko로 폴백. */
export const PRIVACY_LOCALE_COOKIE = "p-locale";

export function isPrivacyLang(v: string | undefined | null): v is PrivacyLang {
  return v === "ko" || v === "en" || v === "vi";
}

/** 로케일 해석: ?lang= > p-locale 쿠키 > 기본 ko. 지원 외(ru/zh) 값은 ko로 폴백. */
export function resolvePrivacyLang(
  param?: string | null,
  cookie?: string | null
): PrivacyLang {
  if (isPrivacyLang(param)) return param;
  if (isPrivacyLang(cookie)) return cookie;
  return "ko";
}

export const PRIVACY_LANG_NATIVE: Record<PrivacyLang, string> = {
  ko: "한국어",
  en: "English",
  vi: "Tiếng Việt",
};

/** 시행일(고정) — 서비스·법령 변경 시 갱신하며 이 값을 올린다. */
export const PRIVACY_EFFECTIVE_DATE = "2026-07-16";

// ── 콘텐츠 블록 모델 ─────────────────────────────────────────────────────────
export type PolicyBlock =
  | { type: "p"; text: string } // 문단
  | { type: "ul"; items: string[] } // 글머리 목록
  | { type: "dl"; rows: { term: string; desc: string }[] }; // 항목-설명 목록

export interface PolicySection {
  id: string;
  title: string;
  blocks: PolicyBlock[];
}

export interface PrivacyPolicy {
  /** 브라우저 <title> 및 페이지 제목 */
  title: string;
  /** 부제(시행일 라벨 접두) — "시행일: " 등 */
  effectiveLabel: string;
  intro: PolicyBlock[];
  sections: PolicySection[];
  /** 하단 고지(비확정본·갱신 안내) */
  disclaimer: string;
  /** 언어 선택기 라벨 */
  langLabel: string;
}

export const PRIVACY_POLICY: Record<PrivacyLang, PrivacyPolicy> = {
  // ─────────────────────────────── 한국어 (원문) ───────────────────────────────
  ko: {
    title: "개인정보처리방침",
    effectiveLabel: "시행일",
    langLabel: "언어",
    intro: [
      {
        type: "p",
        text: "Villa Go(villa-go.net, 이하 “서비스”)는 푸꾸옥 빌라 예약·체크인·상담 서비스를 제공하면서 이용자의 개인정보를 소중히 다룹니다. 본 방침은 서비스가 어떤 개인정보를 어떤 목적으로 수집·이용하며, 누구에게 제공·위탁하고, 얼마나 보관하는지, 그리고 이용자가 어떤 권리를 가지는지를 설명합니다.",
      },
      {
        type: "p",
        text: "서비스 이용자에는 회원(빌라 공급자·여행사·부가서비스 업체 등), 예약 고객과 실제 투숙객이 포함됩니다.",
      },
    ],
    sections: [
      {
        id: "items",
        title: "1. 수집하는 개인정보 항목",
        blocks: [
          {
            type: "p",
            text: "서비스는 이용 과정에서 다음 정보를 수집합니다.",
          },
          {
            type: "dl",
            rows: [
              {
                term: "회원 계정 정보",
                desc: "이름, 전화번호, 비밀번호(단방향 암호화하여 저장), 역할 구분, 사용 언어. Zalo 계정을 연결하는 경우 Zalo 사용자 식별값.",
              },
              {
                term: "예약·체크인 정보",
                desc: "투숙객 명단(이름·생년월일), 여권 사진(정보면)과 여권에서 확인되는 성명·국적·여권번호 등 신원 정보, 전자 서명(체크인 동의서), 체크인·체크아웃 기록, 보증금 관련 기록.",
              },
              {
                term: "상담·문의 정보",
                desc: "카카오톡 채널, Zalo, 홈페이지 채팅 등으로 문의하실 때 남기신 대화 내용과 연락처.",
              },
              {
                term: "결제·거래 정보",
                desc: "예약 금액, 입금자명, 결제·정산 상태 등 거래 기록. (서비스는 카드번호 등 결제수단 상세정보를 직접 저장하지 않습니다.)",
              },
              {
                term: "자동 수집 정보",
                desc: "접속 IP 주소, 접속 일시, 기기·브라우저 정보, 서비스 이용 기록, 보안 이벤트 기록, 쿠키.",
              },
            ],
          },
        ],
      },
      {
        id: "purpose",
        title: "2. 개인정보의 이용 목적",
        blocks: [
          {
            type: "ul",
            items: [
              "예약의 접수·확정·이행 및 체크인·체크아웃 처리",
              "본인 확인, 부정 이용 방지, 문의·분쟁 대응",
              "베트남 임시거주신고(tạm trú) 등 법령상 의무 이행 (여권 정보 처리의 법적 근거 — 아래 3항 참고)",
              "고객 상담·문의 응대 및 예약 관련 알림 발송",
              "서비스 품질 개선, 이용 통계 분석, 안정적인 운영과 보안 유지",
            ],
          },
        ],
      },
      {
        id: "tamtru",
        title: "3. 여권 정보와 임시거주신고(tạm trú)",
        blocks: [
          {
            type: "p",
            text: "베트남 법령상 외국인이 숙박할 때에는 숙소를 관리하는 현지 관리인이 임시거주신고(tạm trú)를 해야 합니다. 이 신고에는 투숙객의 실제 신원 확인이 필요하므로, 서비스는 체크인 시 여권 정보와 여권 사진을 수집합니다.",
          },
          {
            type: "p",
            text: "신고를 위해 서비스는 해당 예약 빌라를 담당하는 현지 관리인(빌라 공급자)에게 여권 사진면 1장과 투숙객 성명·체크인일을 Zalo 메시지로 전달합니다. 전달 대상은 서버가 예약 정보로 자동 결정하며, 판매가·마진·다른 예약 정보는 함께 전달되지 않습니다.",
          },
          {
            type: "p",
            text: "이 제3자 전달은 체크인 동의서에 명시되어 있으며, 동의서에 서명하지 않으면 체크인이 완료되지 않습니다. 즉 여권 전달은 이용자의 사전 동의를 전제로만 이루어집니다.",
          },
          {
            type: "p",
            text: "다만 한 번 전달되어 관리인의 기기(Zalo·휴대전화)에 저장된 여권 사본은 서비스가 기술적으로 회수하거나 삭제할 수 없습니다. 서비스는 필요한 최소한(사진면 1장)만 전달하고, 신고 완료 후 삭제를 권고하며, 전달 이력을 기록하는 방식으로 위험을 최소화합니다.",
          },
        ],
      },
      {
        id: "thirdParty",
        title: "4. 개인정보의 제3자 제공",
        blocks: [
          {
            type: "p",
            text: "서비스는 원칙적으로 이용자의 개인정보를 외부에 제공하지 않습니다. 다만 다음의 경우에는 예외로 합니다.",
          },
          {
            type: "dl",
            rows: [
              {
                term: "빌라 현지 관리인(공급자)",
                desc: "임시거주신고(tạm trú) 목적으로 여권 사진면 1장·투숙객 성명·체크인일을 전달합니다(위 3항, 이용자 동의 전제).",
              },
              {
                term: "법령에 따른 요청",
                desc: "법령에 근거하거나 수사기관이 적법한 절차에 따라 요청하는 경우.",
              },
            ],
          },
        ],
      },
      {
        id: "delegation",
        title: "5. 개인정보 처리위탁",
        blocks: [
          {
            type: "p",
            text: "서비스는 원활한 운영을 위해 다음 업체에 개인정보 처리 업무의 일부를 위탁하고 있습니다. 위탁 시 관련 법령에 따라 안전한 처리를 위해 필요한 사항을 관리·감독합니다.",
          },
          {
            type: "dl",
            rows: [
              {
                term: "Zalo (VNG Corporation)",
                desc: "예약·체크인 관련 알림 발송 및 여권 사진 전달 메시지 채널.",
              },
              {
                term: "Google (Gemini API)",
                desc: "다국어 번역 및 여권 정보 광학 문자 인식(OCR) 처리.",
              },
              {
                term: "Meta Platforms (Instagram·Facebook)",
                desc: "마케팅·홍보 및 소셜 채널을 통한 문의 응대.",
              },
              {
                term: "Cloudflare",
                desc: "콘텐츠 전송(CDN), 보안(WAF)·비정상 트래픽 차단, 파일·백업 저장(R2).",
              },
              {
                term: "Railway",
                desc: "서비스 서버 및 데이터베이스 호스팅.",
              },
            ],
          },
        ],
      },
      {
        id: "retention",
        title: "6. 개인정보의 보관 기간 및 파기",
        blocks: [
          {
            type: "p",
            text: "서비스는 수집 목적이 달성되면 지체 없이 개인정보를 파기합니다. 다만 항목별로 아래 기준을 따릅니다.",
          },
          {
            type: "ul",
            items: [
              "여권 사진 등 신원 확인용 민감정보: 임시거주신고 등 목적 달성 후 파기하며, 원칙적으로 90일 이내 보관을 목표로 합니다.",
              "회원 계정 정보: 회원 탈퇴 또는 삭제 요청 시 파기합니다.",
              "결제·정산 기록 및 접속·보안 로그: 분쟁 대응 및 관련 법령 준수를 위해 필요한 기간 동안 보관 후 파기합니다.",
            ],
          },
          {
            type: "p",
            text: "전자적 형태의 정보는 복구가 불가능한 방법으로 삭제합니다.",
          },
        ],
      },
      {
        id: "rights",
        title: "7. 이용자의 권리와 행사 방법",
        blocks: [
          {
            type: "p",
            text: "이용자는 언제든지 자신의 개인정보에 대해 다음 권리를 행사할 수 있습니다.",
          },
          {
            type: "ul",
            items: [
              "개인정보 열람 요청",
              "오류에 대한 정정 요청",
              "삭제 및 처리정지 요청",
              "동의 철회",
            ],
          },
          {
            type: "p",
            text: "권리 행사는 아래 문의처(10항)를 통해 요청하실 수 있으며, 서비스는 지체 없이 조치합니다. 다만 임시거주신고를 위해 이미 현지 관리인에게 전달되어 관리인의 기기에 저장된 여권 사본은 기술적으로 회수할 수 없으며, 동의 철회는 향후 처리에만 적용됩니다.",
          },
        ],
      },
      {
        id: "cookies",
        title: "8. 쿠키 등 자동 수집 장치",
        blocks: [
          {
            type: "p",
            text: "서비스는 로그인 세션 유지, 언어 설정 기억, 보안 유지를 위해 쿠키를 사용합니다. 이용자는 브라우저 설정을 통해 쿠키 저장을 거부할 수 있으나, 이 경우 로그인 등 일부 기능 이용에 제한이 있을 수 있습니다.",
          },
        ],
      },
      {
        id: "security",
        title: "9. 개인정보의 안전성 확보 조치",
        blocks: [
          {
            type: "ul",
            items: [
              "비밀번호는 단방향 암호화하여 저장하며, 원문을 보관하지 않습니다.",
              "여권 등 민감정보는 외부에서 직접 접근할 수 없는 비공개 저장소에 보관하고, 접근 권한을 최소화합니다.",
              "전송 구간은 HTTPS로 암호화합니다.",
              "개인정보 접근·전달 내역을 기록·점검하여 오·남용을 방지합니다.",
            ],
          },
        ],
      },
      {
        id: "contact",
        title: "10. 문의처",
        blocks: [
          {
            type: "p",
            text: "개인정보 처리에 관한 문의·요청·불만은 아래로 연락해 주십시오.",
          },
          {
            type: "dl",
            rows: [
              { term: "카카오톡 채널", desc: "pf.kakao.com/_mVAfX" },
              { term: "Zalo", desc: "zalo.me/0799493138" },
              { term: "이메일", desc: "biz.villago@gmail.com" },
            ],
          },
        ],
      },
      {
        id: "changes",
        title: "11. 고지 의무",
        blocks: [
          {
            type: "p",
            text: "본 방침의 내용이 변경되는 경우, 변경 사항을 본 페이지를 통해 공지합니다.",
          },
        ],
      },
    ],
    disclaimer:
      "본 방침은 서비스 변경 및 관련 법령에 따라 갱신될 수 있으며, 법률 자문을 거친 최종 확정본이 아닙니다.",
  },

  // ─────────────────────────────── English ───────────────────────────────
  en: {
    title: "Privacy Policy",
    effectiveLabel: "Effective date",
    langLabel: "Language",
    intro: [
      {
        type: "p",
        text: "Villa Go (villa-go.net, the “Service”) provides villa reservation, check-in, and customer support for Phu Quoc, and takes the protection of your personal data seriously. This policy explains what personal data the Service collects and why, whom it is shared with or entrusted to, how long it is kept, and what rights you have.",
      },
      {
        type: "p",
        text: "Users of the Service include members (villa suppliers, travel agencies, add-on service vendors, etc.), booking customers, and the actual guests who stay.",
      },
    ],
    sections: [
      {
        id: "items",
        title: "1. Personal Data We Collect",
        blocks: [
          { type: "p", text: "The Service collects the following data in the course of use." },
          {
            type: "dl",
            rows: [
              {
                term: "Member account data",
                desc: "Name, phone number, password (stored one-way encrypted), role, and preferred language. If you link a Zalo account, your Zalo user identifier.",
              },
              {
                term: "Reservation & check-in data",
                desc: "Guest list (name and date of birth), passport photo (data page) and identity details read from it such as name, nationality, and passport number, electronic signature (check-in agreement), check-in/check-out records, and deposit-related records.",
              },
              {
                term: "Support & inquiry data",
                desc: "Conversation content and contact details you provide when contacting us via the KakaoTalk channel, Zalo, or website chat.",
              },
              {
                term: "Payment & transaction data",
                desc: "Reservation amounts, depositor name, and payment/settlement status. (The Service does not directly store payment instrument details such as card numbers.)",
              },
              {
                term: "Automatically collected data",
                desc: "IP address, access time, device and browser information, service usage records, security event logs, and cookies.",
              },
            ],
          },
        ],
      },
      {
        id: "purpose",
        title: "2. Purposes of Use",
        blocks: [
          {
            type: "ul",
            items: [
              "Receiving, confirming, and fulfilling reservations, and processing check-in/check-out",
              "Identity verification, fraud prevention, and handling inquiries and disputes",
              "Fulfilling legal obligations such as Vietnamese temporary residence registration (tạm trú) — the legal basis for processing passport data (see Section 3)",
              "Responding to customer inquiries and sending reservation-related notifications",
              "Improving service quality, analyzing usage statistics, and maintaining stable, secure operations",
            ],
          },
        ],
      },
      {
        id: "tamtru",
        title: "3. Passport Data and Temporary Residence Registration (tạm trú)",
        blocks: [
          {
            type: "p",
            text: "Under Vietnamese law, when a foreign national stays overnight, the local manager of the accommodation must file a temporary residence registration (tạm trú). This filing requires verification of the guest's actual identity, so the Service collects passport information and a passport photo at check-in.",
          },
          {
            type: "p",
            text: "For this filing, the Service forwards one passport data-page photo along with the guest's name and check-in date to the local manager (villa supplier) responsible for the reserved villa, via a Zalo message. The recipient is determined automatically by the server from the reservation, and no sale prices, margins, or other reservation data are sent.",
          },
          {
            type: "p",
            text: "This third-party transfer is stated in the check-in agreement, and check-in cannot be completed without signing it. In other words, passport data is forwarded only on the basis of your prior consent.",
          },
          {
            type: "p",
            text: "However, once forwarded, a passport copy saved on the manager's device (Zalo / mobile phone) cannot be technically retrieved or deleted by the Service. The Service minimizes the risk by forwarding only the minimum necessary (one data-page photo), recommending deletion after the filing is complete, and logging every transfer.",
          },
        ],
      },
      {
        id: "thirdParty",
        title: "4. Provision to Third Parties",
        blocks: [
          {
            type: "p",
            text: "As a rule, the Service does not provide your personal data to outside parties, except in the following cases.",
          },
          {
            type: "dl",
            rows: [
              {
                term: "Local villa manager (supplier)",
                desc: "One passport data-page photo, the guest's name, and the check-in date are forwarded for temporary residence registration (tạm trú) (see Section 3; subject to your consent).",
              },
              {
                term: "Requests under law",
                desc: "Where required by law or requested by an investigative authority through lawful procedures.",
              },
            ],
          },
        ],
      },
      {
        id: "delegation",
        title: "5. Entrustment of Processing",
        blocks: [
          {
            type: "p",
            text: "For smooth operation, the Service entrusts parts of personal data processing to the following providers. When entrusting, we manage and supervise the matters necessary for safe processing in accordance with applicable law.",
          },
          {
            type: "dl",
            rows: [
              { term: "Zalo (VNG Corporation)", desc: "Messaging channel for reservation/check-in notifications and passport photo transfer." },
              { term: "Google (Gemini API)", desc: "Multilingual translation and optical character recognition (OCR) of passport data." },
              { term: "Meta Platforms (Instagram / Facebook)", desc: "Marketing and handling inquiries via social channels." },
              { term: "Cloudflare", desc: "Content delivery (CDN), security (WAF) and abnormal-traffic blocking, and file/backup storage (R2)." },
              { term: "Railway", desc: "Hosting of the service servers and database." },
            ],
          },
        ],
      },
      {
        id: "retention",
        title: "6. Retention Period and Destruction",
        blocks: [
          {
            type: "p",
            text: "The Service destroys personal data without delay once the purpose of collection is achieved, subject to the following standards by category.",
          },
          {
            type: "ul",
            items: [
              "Sensitive identity data such as passport photos: destroyed after the purpose (e.g., temporary residence registration) is achieved, with a target retention of within 90 days.",
              "Member account data: destroyed upon account withdrawal or a deletion request.",
              "Payment/settlement records and access/security logs: kept for the period necessary to handle disputes and comply with applicable law, then destroyed.",
            ],
          },
          { type: "p", text: "Data in electronic form is deleted by a method that makes recovery impossible." },
        ],
      },
      {
        id: "rights",
        title: "7. Your Rights and How to Exercise Them",
        blocks: [
          { type: "p", text: "You may exercise the following rights regarding your personal data at any time." },
          {
            type: "ul",
            items: [
              "Request access to your personal data",
              "Request correction of errors",
              "Request deletion or suspension of processing",
              "Withdraw consent",
            ],
          },
          {
            type: "p",
            text: "You may make such requests through the contact points below (Section 10), and the Service will act without delay. However, a passport copy already forwarded to a local manager and stored on the manager's device for temporary residence registration cannot be technically retrieved, and withdrawal of consent applies only to future processing.",
          },
        ],
      },
      {
        id: "cookies",
        title: "8. Cookies and Automatic Collection",
        blocks: [
          {
            type: "p",
            text: "The Service uses cookies to maintain login sessions, remember language settings, and preserve security. You can refuse cookie storage through your browser settings, but some features such as login may then be limited.",
          },
        ],
      },
      {
        id: "security",
        title: "9. Security Measures",
        blocks: [
          {
            type: "ul",
            items: [
              "Passwords are stored one-way encrypted; the original is not retained.",
              "Sensitive data such as passports is kept in private storage that cannot be accessed directly from outside, with access privileges minimized.",
              "Data in transit is encrypted with HTTPS.",
              "Access to and transfers of personal data are logged and reviewed to prevent misuse.",
            ],
          },
        ],
      },
      {
        id: "contact",
        title: "10. Contact",
        blocks: [
          { type: "p", text: "For inquiries, requests, or complaints regarding the processing of personal data, please contact us." },
          {
            type: "dl",
            rows: [
              { term: "KakaoTalk channel", desc: "pf.kakao.com/_mVAfX" },
              { term: "Zalo", desc: "zalo.me/0799493138" },
              { term: "Email", desc: "biz.villago@gmail.com" },
            ],
          },
        ],
      },
      {
        id: "changes",
        title: "11. Notice of Changes",
        blocks: [
          { type: "p", text: "If this policy changes, we will announce the changes on this page." },
        ],
      },
    ],
    disclaimer:
      "This policy may be updated in line with changes to the Service and applicable law, and is not a final version reviewed by legal counsel.",
  },

  // ─────────────────────────────── Tiếng Việt ───────────────────────────────
  vi: {
    title: "Chính sách bảo mật",
    effectiveLabel: "Ngày hiệu lực",
    langLabel: "Ngôn ngữ",
    intro: [
      {
        type: "p",
        text: "Villa Go (villa-go.net, sau đây gọi là “Dịch vụ”) cung cấp dịch vụ đặt biệt thự, nhận phòng và hỗ trợ khách hàng tại Phú Quốc, và luôn coi trọng việc bảo vệ thông tin cá nhân của người dùng. Chính sách này giải thích Dịch vụ thu thập thông tin cá nhân nào và nhằm mục đích gì, cung cấp hoặc ủy thác cho ai, lưu giữ trong bao lâu, và Quý khách có những quyền gì.",
      },
      {
        type: "p",
        text: "Người dùng Dịch vụ bao gồm thành viên (chủ biệt thự, công ty du lịch, đơn vị cung cấp dịch vụ thêm...), khách đặt phòng và khách thực tế lưu trú.",
      },
    ],
    sections: [
      {
        id: "items",
        title: "1. Thông tin cá nhân được thu thập",
        blocks: [
          { type: "p", text: "Dịch vụ thu thập những thông tin sau trong quá trình sử dụng." },
          {
            type: "dl",
            rows: [
              {
                term: "Thông tin tài khoản thành viên",
                desc: "Họ tên, số điện thoại, mật khẩu (lưu dưới dạng mã hóa một chiều), vai trò và ngôn ngữ sử dụng. Nếu Quý khách liên kết tài khoản Zalo, mã định danh người dùng Zalo.",
              },
              {
                term: "Thông tin đặt phòng & nhận phòng",
                desc: "Danh sách khách (họ tên và ngày sinh), ảnh hộ chiếu (trang thông tin) và các thông tin nhân thân đọc được từ đó như họ tên, quốc tịch, số hộ chiếu; chữ ký điện tử (bản đồng ý khi nhận phòng); hồ sơ nhận/trả phòng; hồ sơ liên quan đến tiền đặt cọc.",
              },
              {
                term: "Thông tin hỗ trợ & liên hệ",
                desc: "Nội dung trao đổi và thông tin liên hệ Quý khách để lại khi liên hệ qua kênh KakaoTalk, Zalo hoặc trò chuyện trên trang web.",
              },
              {
                term: "Thông tin thanh toán & giao dịch",
                desc: "Số tiền đặt phòng, tên người chuyển khoản, trạng thái thanh toán/quyết toán. (Dịch vụ không trực tiếp lưu chi tiết phương thức thanh toán như số thẻ.)",
              },
              {
                term: "Thông tin thu thập tự động",
                desc: "Địa chỉ IP, thời điểm truy cập, thông tin thiết bị và trình duyệt, lịch sử sử dụng dịch vụ, nhật ký sự kiện bảo mật và cookie.",
              },
            ],
          },
        ],
      },
      {
        id: "purpose",
        title: "2. Mục đích sử dụng thông tin cá nhân",
        blocks: [
          {
            type: "ul",
            items: [
              "Tiếp nhận, xác nhận và thực hiện đặt phòng, xử lý nhận phòng/trả phòng",
              "Xác minh danh tính, ngăn ngừa gian lận, xử lý thắc mắc và tranh chấp",
              "Thực hiện nghĩa vụ pháp lý như khai báo tạm trú tại Việt Nam — cơ sở pháp lý cho việc xử lý thông tin hộ chiếu (xem mục 3)",
              "Hỗ trợ, giải đáp thắc mắc của khách hàng và gửi thông báo liên quan đến đặt phòng",
              "Nâng cao chất lượng dịch vụ, phân tích thống kê sử dụng và duy trì vận hành ổn định, an toàn",
            ],
          },
        ],
      },
      {
        id: "tamtru",
        title: "3. Thông tin hộ chiếu và khai báo tạm trú",
        blocks: [
          {
            type: "p",
            text: "Theo pháp luật Việt Nam, khi người nước ngoài lưu trú qua đêm, người quản lý cơ sở lưu trú tại địa phương phải thực hiện khai báo tạm trú. Việc khai báo cần xác minh danh tính thực tế của khách, nên Dịch vụ thu thập thông tin và ảnh hộ chiếu khi nhận phòng.",
          },
          {
            type: "p",
            text: "Để khai báo, Dịch vụ chuyển một ảnh trang thông tin hộ chiếu cùng họ tên khách và ngày nhận phòng cho người quản lý địa phương (chủ biệt thự) phụ trách biệt thự đã đặt, qua tin nhắn Zalo. Người nhận do máy chủ tự động xác định từ thông tin đặt phòng, và không gửi kèm giá bán, lợi nhuận hay thông tin đặt phòng khác.",
          },
          {
            type: "p",
            text: "Việc chuyển cho bên thứ ba này được nêu rõ trong bản đồng ý khi nhận phòng, và không thể hoàn tất nhận phòng nếu chưa ký. Nghĩa là thông tin hộ chiếu chỉ được chuyển khi Quý khách đã đồng ý trước.",
          },
          {
            type: "p",
            text: "Tuy nhiên, một khi đã chuyển đi, bản sao hộ chiếu được lưu trên thiết bị của người quản lý (Zalo / điện thoại) thì Dịch vụ không thể thu hồi hay xóa về mặt kỹ thuật. Dịch vụ giảm thiểu rủi ro bằng cách chỉ chuyển mức tối thiểu cần thiết (một ảnh trang thông tin), khuyến nghị xóa sau khi hoàn tất khai báo, và ghi nhật ký mỗi lần chuyển.",
          },
        ],
      },
      {
        id: "thirdParty",
        title: "4. Cung cấp thông tin cho bên thứ ba",
        blocks: [
          {
            type: "p",
            text: "Về nguyên tắc, Dịch vụ không cung cấp thông tin cá nhân của Quý khách cho bên ngoài, trừ các trường hợp sau.",
          },
          {
            type: "dl",
            rows: [
              {
                term: "Người quản lý biệt thự tại địa phương (chủ biệt thự)",
                desc: "Chuyển một ảnh trang thông tin hộ chiếu, họ tên khách và ngày nhận phòng nhằm mục đích khai báo tạm trú (xem mục 3; với điều kiện Quý khách đã đồng ý).",
              },
              {
                term: "Yêu cầu theo pháp luật",
                desc: "Khi pháp luật quy định hoặc cơ quan điều tra yêu cầu theo trình tự hợp pháp.",
              },
            ],
          },
        ],
      },
      {
        id: "delegation",
        title: "5. Ủy thác xử lý thông tin cá nhân",
        blocks: [
          {
            type: "p",
            text: "Để vận hành thông suốt, Dịch vụ ủy thác một phần công việc xử lý thông tin cá nhân cho các đơn vị sau. Khi ủy thác, chúng tôi quản lý và giám sát những nội dung cần thiết để xử lý an toàn theo quy định pháp luật.",
          },
          {
            type: "dl",
            rows: [
              { term: "Zalo (Công ty VNG)", desc: "Kênh tin nhắn để gửi thông báo đặt phòng/nhận phòng và chuyển ảnh hộ chiếu." },
              { term: "Google (Gemini API)", desc: "Dịch đa ngôn ngữ và nhận dạng ký tự quang học (OCR) thông tin hộ chiếu." },
              { term: "Meta Platforms (Instagram / Facebook)", desc: "Tiếp thị và giải đáp thắc mắc qua kênh mạng xã hội." },
              { term: "Cloudflare", desc: "Phân phối nội dung (CDN), bảo mật (WAF) và chặn lưu lượng bất thường, lưu trữ tệp/sao lưu (R2)." },
              { term: "Railway", desc: "Lưu trữ (hosting) máy chủ và cơ sở dữ liệu của Dịch vụ." },
            ],
          },
        ],
      },
      {
        id: "retention",
        title: "6. Thời gian lưu giữ và hủy thông tin",
        blocks: [
          {
            type: "p",
            text: "Dịch vụ hủy thông tin cá nhân không chậm trễ khi đã đạt mục đích thu thập, theo các tiêu chuẩn sau cho từng loại.",
          },
          {
            type: "ul",
            items: [
              "Thông tin nhạy cảm dùng để xác minh danh tính như ảnh hộ chiếu: hủy sau khi đạt mục đích (ví dụ: khai báo tạm trú), với mục tiêu lưu giữ trong vòng 90 ngày.",
              "Thông tin tài khoản thành viên: hủy khi Quý khách rời khỏi hoặc yêu cầu xóa.",
              "Hồ sơ thanh toán/quyết toán và nhật ký truy cập/bảo mật: lưu giữ trong thời gian cần thiết để xử lý tranh chấp và tuân thủ pháp luật liên quan, sau đó hủy.",
            ],
          },
          { type: "p", text: "Thông tin ở dạng điện tử được xóa bằng phương pháp không thể khôi phục." },
        ],
      },
      {
        id: "rights",
        title: "7. Quyền của người dùng và cách thực hiện",
        blocks: [
          { type: "p", text: "Quý khách có thể thực hiện các quyền sau đối với thông tin cá nhân của mình bất cứ lúc nào." },
          {
            type: "ul",
            items: [
              "Yêu cầu xem thông tin cá nhân",
              "Yêu cầu chỉnh sửa thông tin sai sót",
              "Yêu cầu xóa hoặc ngừng xử lý",
              "Rút lại sự đồng ý",
            ],
          },
          {
            type: "p",
            text: "Quý khách có thể gửi yêu cầu qua thông tin liên hệ bên dưới (mục 10), và Dịch vụ sẽ xử lý không chậm trễ. Tuy nhiên, bản sao hộ chiếu đã được chuyển cho người quản lý địa phương và lưu trên thiết bị của họ để khai báo tạm trú thì không thể thu hồi về mặt kỹ thuật, và việc rút lại sự đồng ý chỉ áp dụng cho việc xử lý về sau.",
          },
        ],
      },
      {
        id: "cookies",
        title: "8. Cookie và công cụ thu thập tự động",
        blocks: [
          {
            type: "p",
            text: "Dịch vụ sử dụng cookie để duy trì phiên đăng nhập, ghi nhớ cài đặt ngôn ngữ và bảo đảm an ninh. Quý khách có thể từ chối lưu cookie qua cài đặt trình duyệt, nhưng khi đó một số chức năng như đăng nhập có thể bị hạn chế.",
          },
        ],
      },
      {
        id: "security",
        title: "9. Biện pháp bảo đảm an toàn thông tin cá nhân",
        blocks: [
          {
            type: "ul",
            items: [
              "Mật khẩu được lưu dưới dạng mã hóa một chiều; không lưu bản gốc.",
              "Thông tin nhạy cảm như hộ chiếu được lưu trong kho riêng không thể truy cập trực tiếp từ bên ngoài, với quyền truy cập được giảm tới mức tối thiểu.",
              "Dữ liệu trên đường truyền được mã hóa bằng HTTPS.",
              "Việc truy cập và chuyển thông tin cá nhân được ghi nhật ký và rà soát để ngăn lạm dụng.",
            ],
          },
        ],
      },
      {
        id: "contact",
        title: "10. Liên hệ",
        blocks: [
          { type: "p", text: "Mọi thắc mắc, yêu cầu hoặc khiếu nại về việc xử lý thông tin cá nhân, xin liên hệ." },
          {
            type: "dl",
            rows: [
              { term: "Kênh KakaoTalk", desc: "pf.kakao.com/_mVAfX" },
              { term: "Zalo", desc: "zalo.me/0799493138" },
              { term: "Email", desc: "biz.villago@gmail.com" },
            ],
          },
        ],
      },
      {
        id: "changes",
        title: "11. Nghĩa vụ thông báo",
        blocks: [
          { type: "p", text: "Nếu nội dung chính sách này thay đổi, chúng tôi sẽ thông báo thay đổi trên trang này." },
        ],
      },
    ],
    disclaimer:
      "Chính sách này có thể được cập nhật theo thay đổi của Dịch vụ và pháp luật liên quan, và không phải là bản cuối cùng đã qua tư vấn pháp lý.",
  },
};
