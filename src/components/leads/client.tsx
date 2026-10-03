"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { leadStatusAction } from "@/app/actions/ops";
import { Menu, MenuItem } from "@/components/ui/client";
import { Icon } from "@/components/ui/icon";
import { humanize } from "@/lib/format";
import { nextStates } from "@/lib/state";

export function LeadStatusMenu({ id, status, converted }: { id: string; status: string; converted: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const options = nextStates("lead", status).filter((s) => !(s === "WON" && !converted));
  if (options.length === 0) return null;
  const move = (to: string) => {
    let reason: string | undefined;
    if (to === "LOST") {
      const r = window.prompt("Why was this lead lost?");
      if (!r) return;
      reason = r;
    }
    start(async () => {
      const res = await leadStatusAction(id, to, reason);
      if (res.ok) { toast.success(`Moved to ${humanize(to)}`); router.refresh(); } else toast.error(res.error);
    });
  };
  return (
    <Menu trigger={<span className={`inline-flex items-center gap-1 rounded-md border border-line-strong bg-surface px-2 py-1 text-xs font-medium hover:bg-surface-2 ${pending ? "opacity-60" : ""}`}>Move <Icon name="chevron-down" size={12} /></span>}>
      {options.map((s) => <MenuItem key={s} onClick={() => move(s)}>{humanize(s)}</MenuItem>)}
    </Menu>
  );
}
