// 데모: 청소직원(demo-cleaner-hoa) 로그인 + 배정 청소 태스크 + 빌라 청소정보(C/D).
//   멱등 — 재실행 시 이 청소원의 기존 데모 태스크를 지우고 다시 생성.
//   실행: node --env-file=.env prisma/seed-cleaner-demo.mjs
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const CLEANER_ID = "demo-cleaner-hoa";
const PASSWORD = "Demo!Clean24";

// @db.Date 용 — UTC 자정 날짜
function dateOnly(offsetDays) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

async function main() {
  // 1) 로그인 비밀번호 설정(요청값) — 강제변경 해제, 활성, 세션 baseline 갱신
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { id: CLEANER_ID },
    update: {
      // 청소직원 화면은 vi 전용 — 이름도 한국어 병기 제거(Chị Hoa)
      name: "Chị Hoa",
      passwordHash,
      isActive: true,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
    create: {
      id: CLEANER_ID,
      name: "Chị Hoa",
      phone: "0907654321",
      role: "CLEANER",
      passwordHash,
      isActive: true,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
    select: { id: true, name: true, phone: true, role: true },
  });
  console.log("✔ 청소원 계정:", JSON.stringify(user));

  // 2) 실제 존재하는 빌라 중 일부 선택 — 청소정보 갱신(베트남어, 청소원이 읽음)
  const existingVillas = await prisma.villa.findMany({ where: { status: "ACTIVE" }, take: 6, select: { id: true } });
  const selectedVillas = existingVillas.slice(0, 6);

  const villaCleaningInfo = [
    { accessType: "KEYPAD", accessInfo: "Mã cửa: 2580# · Chìa khóa dự phòng ở hộp sắt cạnh cổng", cleaningNotes: "Vệ sinh lưới điều hòa 2 phòng ngủ · Lau kỹ kính phòng tắm" },
    { accessType: "KEYPAD", accessInfo: "Mã cửa: 1357# · Hồ bơi: cẩn thận sàn trơn", cleaningNotes: "Cẩn thận sàn đá cẩm thạch (lau khô ngay) · Kiểm tra khăn hồ bơi" },
    { accessType: "KEYPAD", accessInfo: "Mã cửa: 4826#", cleaningNotes: "Thay lưới lọc điều hòa phòng khách" },
    { accessType: "KEY", accessInfo: "Chìa khóa nhận tại quầy lễ tân (xuất trình mã đặt phòng)", cleaningNotes: "Ban công nhiều lá rụng · Quét kỹ" },
    { accessType: "KEYPAD", accessInfo: "Mã cửa: 9043#", cleaningNotes: "" },
    { accessType: "KEY", accessInfo: "Chìa khóa tại văn phòng quản lý · 5 phòng ngủ — bố trí đủ thời gian", cleaningNotes: "Vệ sinh định kỳ: kiểm tra rèm, đèn, vòi nước" },
  ];

  for (let i = 0; i < selectedVillas.length; i++) {
    const info = villaCleaningInfo[i];
    await prisma.villa.update({
      where: { id: selectedVillas[i].id },
      data: {
        accessType: info.accessType || null,
        accessInfo: info.accessInfo || null,
        cleaningNotes: info.cleaningNotes || null,
      },
    });
  }
  console.log("✔ 빌라 청소정보(출입·메모) 갱신:", selectedVillas.length, "곳");

  // 베이스라인 사진 URL(제출/승인 태스크의 photoUrls로 재사용 — 읽기 그리드에 이미지 표시)
  async function baselineUrls(villaId) {
    const photos = await prisma.villaPhoto.findMany({
      where: { villaId, isBaseline: true },
      orderBy: [{ space: "asc" }, { sortOrder: "asc" }],
      select: { url: true },
      take: 12,
    });
    return photos.map((p) => p.url);
  }

  // 3) 기존 데모 태스크 정리(멱등) — 이 청소원 배정분만
  const del = await prisma.cleaningTask.deleteMany({ where: { assigneeId: CLEANER_ID } });
  console.log("✔ 기존 배정 태스크 정리:", del.count);

  // 4) 상태별 데모 태스크 생성 (선택된 빌라 사용)
  const v = selectedVillas.map(x => x.id);
  const submitted = await baselineUrls(v[3] || v[0]);
  const approved = await baselineUrls(v[4] || v[1]);

  const tasks = [
    { villaId: v[0], type: "CHECKOUT", status: "PENDING", dueDate: dateOnly(0) },
    { villaId: v[1], type: "CHECKOUT", status: "PENDING", dueDate: dateOnly(1) },
    {
      villaId: v[2],
      type: "CHECKOUT",
      status: "REJECTED",
      dueDate: dateOnly(-1),
      rejectNote: "Phòng tắm phòng ngủ 2 còn vết nước. Vui lòng lau lại và chụp lại ảnh.",
    },
    {
      villaId: v[3] || v[0],
      type: "CHECKOUT",
      status: "PHOTOS_SUBMITTED",
      dueDate: dateOnly(0),
      photoUrls: submitted,
    },
    {
      villaId: v[4] || v[1],
      type: "CHECKOUT",
      status: "APPROVED",
      dueDate: dateOnly(-2),
      photoUrls: approved,
      approvedAt: new Date(),
    },
    { villaId: v[5] || v[2], type: "PERIODIC", status: "PENDING", dueDate: dateOnly(3) },
  ];

  for (const t of tasks) {
    await prisma.cleaningTask.create({
      data: {
        villaId: t.villaId,
        assigneeId: CLEANER_ID,
        type: t.type,
        status: t.status,
        dueDate: t.dueDate,
        rejectNote: t.rejectNote ?? null,
        photoUrls: t.photoUrls ?? [],
        approvedAt: t.approvedAt ?? null,
      },
    });
  }
  console.log("✔ 데모 청소 태스크 생성:", tasks.length, "건 (PENDING·REJECTED·SUBMITTED·APPROVED·PERIODIC)");
}

main()
  .then(() => console.log("완료 — 0907654321 / Demo!Clean24 로 로그인"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
