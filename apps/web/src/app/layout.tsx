import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/vazirmatn";
// Display faces of the storefront themes, self-hosted (all OFL; checked for Persian letters, Persian digits and ZWNJ rendering).
// @font-face rules only: a file is downloaded when a page actually uses the face.
import "@fontsource-variable/estedad";
import "@fontsource-variable/el-messiri";
import "@fontsource-variable/alexandria";
import "@fontsource-variable/changa";
import "@fontsource-variable/markazi-text";
import "@fontsource-variable/noto-naskh-arabic";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";

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
