"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Tells the platform "a page of this store was opened", for the merchant's trend charts. Anonymous: no body, no path, no cookie and no
 * identifier are sent; the server counts the view and (per day) a one-way hash of the shopper. Shoppers who send Do Not Track or Global
 * Privacy Control are not counted at all (the server checks the header too). A failure is silent: it must never affect the page.
 */
export default function VisitBeacon() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (last.current === pathname) return; // React strict mode runs effects twice in development
    last.current = pathname;
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.doNotTrack === "1" || nav.globalPrivacyControl) return;
    fetch("/api/shop/visit", { method: "POST", keepalive: true, credentials: "omit" }).catch(() => undefined);
  }, [pathname]);
  return null;
}
