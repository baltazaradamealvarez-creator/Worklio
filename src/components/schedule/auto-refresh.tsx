"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Keeps live boards fresh without a manual reload (pauses while the tab is hidden). */
export function AutoRefresh({ seconds = 45 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
