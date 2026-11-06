"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";

export default function StoreTabs({ storeId }: { storeId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/stores/${encodeURIComponent(storeId)}`;
  const tabs = [
    { label: "محصولات", href: `${base}/products` },
    { label: "دسته‌بندی‌ها", href: `${base}/categories` },
    { label: "تنظیمات", href: base },
  ];
  const active = tabs.find((t) => (t.href === base ? pathname === base : pathname.startsWith(t.href)));
  return (
    <Tabs value={active?.href ?? false} variant="scrollable" scrollButtons={false} aria-label="بخش‌های فروشگاه" sx={{ borderBottom: 1, borderColor: "divider" }}>
      {tabs.map((t) => (
        <Tab key={t.href} label={t.label} value={t.href} component={Link} href={t.href} />
      ))}
    </Tabs>
  );
}
