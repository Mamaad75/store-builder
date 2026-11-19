"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Navigation for form handlers, which are plain functions (no hooks): `<RouterBridge />` (mounted once in the root layout) hands them the
 * App Router. `refresh()` re-renders the server components of the current page with fresh data (what `revalidatePath` did), `go()`
 * navigates to another page.
 */
let current: ReturnType<typeof useRouter> | null = null;

export function RouterBridge(): null {
  const router = useRouter();
  useEffect(() => {
    current = router;
    return () => {
      if (current === router) current = null;
    };
  }, [router]);
  return null;
}

export function go(url: string): void {
  if (current) current.push(url);
  else window.location.assign(url);
}

export function refresh(): void {
  if (current) current.refresh();
  else window.location.reload();
}

/** Hard navigation: used after sign-in/out, where cookies changed and every cached server render must be dropped. */
export function hardGo(url: string): void {
  window.location.assign(url);
}
