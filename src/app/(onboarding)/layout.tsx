import { redirect } from "next/navigation";
import { requireAuth } from "@/server/auth/server";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  if (!auth.ctx) redirect(auth.user.isPlatformAdmin ? "/platform" : "/no-access");
  return <div className="min-h-dvh bg-bg">{children}</div>;
}
