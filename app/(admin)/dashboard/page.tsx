import { auth } from "@/auth";

export default async function DashboardPage() {
  const session = await auth();

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-2">대시보드</h1>
      <p className="text-gray-400">안녕하세요, {session?.user?.name}님</p>
      <p className="text-gray-500 text-sm mt-4">
        Sprint 2 T2.6에서 스탯 카드·타임라인이 추가됩니다.
      </p>
    </div>
  );
}
