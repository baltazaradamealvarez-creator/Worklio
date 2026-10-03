import { redirect } from "next/navigation";
import { can } from "@/server/auth/context";
import { pageCtx } from "@/server/page-context";

export default async function SettingsIndex() {
  const { ctx } = await pageCtx();
  redirect(can(ctx, "settings.manage") ? "/settings/company" : can(ctx, "users.manage") ? "/settings/team" : "/settings/profile");
}
