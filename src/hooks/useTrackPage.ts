"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackPageView } from "@/lib/umami";

export function useTrackPage(customUrl?: string, customTitle?: string, enabled = true) {
  const pathname = usePathname();

  useEffect(() => {
    if (!enabled) return;
    trackPageView(customUrl ?? pathname, customTitle);
  }, [pathname, customUrl, customTitle, enabled]);
}
