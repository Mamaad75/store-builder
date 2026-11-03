import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/vazirmatn";
import ThemeRegistry from "@/theme/ThemeRegistry";

export const metadata: Metadata = {
  title: { default: "سایت‌ساز فروشگاهی", template: "%s | سایت‌ساز فروشگاهی" },
  description: "فروشگاه اینترنتی خود را بدون نیاز به برنامه‌نویسی بسازید و منتشر کنید.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
