import type { Metadata } from "next";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import AppBar from "@mui/material/AppBar";
import StorefrontOutlined from "@mui/icons-material/StorefrontOutlined";
import StorefrontRounded from "@mui/icons-material/StorefrontRounded";
import AccountMenu from "@/components/AccountMenu";
import { RouterBridge } from "@/client/nav";
import { TextLink } from "@/components/NextLinks";
import SiteFooter from "@/components/SiteFooter";
import SkipLink from "@/components/SkipLink";
import ThemeRegistry from "@/theme/ThemeRegistry";
import { assertPlatformHost } from "@/lib/host-guard";
import { requireUser } from "@/modules/auth/session";

// Per-request: always evaluates the session on the server.
export const dynamic = "force-dynamic";

// The application is never indexed (it also sits behind a login).
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await assertPlatformHost(); // never through a store host
  const user = await requireUser();
  return (
    <ThemeRegistry>
      <RouterBridge />
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
        <SkipLink />
        <AppBar data-print="hide" position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "rgba(255,255,255,0.92)", backdropFilter: "blur(8px)" }}>
          <Toolbar sx={{ minHeight: { xs: 56, sm: 64 }, gap: 1.5 }}>
            <TextLink href="/dashboard" underline="none" aria-label="سایت‌ساز فروشگاهی: فروشگاه‌های من" sx={{ display: "flex", alignItems: "center", gap: 1.25, color: "text.primary", flexGrow: 1, minWidth: 0 }}>
              <Box aria-hidden sx={{ width: 34, height: 34, borderRadius: 2, display: "grid", placeItems: "center", color: "#fff", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", flexShrink: 0 }}>
                <StorefrontRounded fontSize="small" />
              </Box>
              <Typography component="span" sx={{ fontWeight: 800, display: { xs: "none", sm: "block" } }}>سایت‌ساز فروشگاهی</Typography>
            </TextLink>
            <Box component="nav" aria-label="منوی حساب" sx={{ display: "flex", alignItems: "center", gap: { xs: 0.75, sm: 1.5 } }}>
              <TextLink href="/dashboard" underline="none" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, px: { xs: 1, sm: 1.5 }, py: 0.75, minHeight: 40, borderRadius: 99, fontWeight: 600, fontSize: 14, color: "text.primary", "&:hover": { bgcolor: "action.hover" } }}>
                <StorefrontOutlined fontSize="small" aria-hidden />
                <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>فروشگاه‌ها</Box>
                <Box component="span" sx={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", display: { xs: "inline", sm: "none" } }}>فروشگاه‌ها</Box>
              </TextLink>
              <AccountMenu name={user.name} username={user.username} />
            </Box>
          </Toolbar>
        </AppBar>
        <Box component="main" id="main">
          {children}
        </Box>
        <SiteFooter />
      </Box>
    </ThemeRegistry>
  );
}
