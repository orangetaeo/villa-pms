import { auth } from "@/auth";

export default async function MyVillasPage() {
  const session = await auth();

  return (
    <div className="px-4 pt-6">
      <h1 className="text-xl font-bold text-gray-900 mb-2">Biệt thự của tôi</h1>
      <p className="text-gray-500 text-sm">Xin chào, {session?.user?.name}</p>
      <p className="text-gray-400 text-xs mt-4">
        Sprint 1 T1.1에서 빌라 등록 마법사가 추가됩니다.
      </p>
    </div>
  );
}
