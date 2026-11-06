import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/vazirmatn";

export const metadata: Metadata = {
  title: { default: "سایت‌ساز فروشگاهی", template: "%s | سایت‌ساز فروشگاهی" },
  description: "فروشگاه اینترنتی خود را بدون نیاز به برنامه‌نویسی بسازید و منتشر کنید.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

/**
 * The root layout is deliberately UI-library free: the dashboard and auth screens opt in to MUI
 * (ThemeRegistry) in their own layouts, while storefront routes render without any dashboard styling.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
