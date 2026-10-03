import { redirect } from "next/navigation";
import { can } from "@/server/auth/context";
import { getAuth } from "@/server/auth/server";

export default async function Home() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!auth.ctx) redirect(auth.user.isPlatformAdmin ? "/platform" : "/no-access");
  const fieldOnly = !can(auth.ctx, "jobs.view") && can(auth.ctx, "jobs.view_assigned");
  redirect(fieldOnly ? "/tech" : "/dashboard");
}
