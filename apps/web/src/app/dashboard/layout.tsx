import type { Metadata } from "next";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import AppBar from "@mui/material/AppBar";
import LogoutButton from "@/components/LogoutButton";
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
        <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
          <Toolbar>
            <Typography sx={{ flexGrow: 1, fontWeight: 700 }}>سایت‌ساز فروشگاهی</Typography>
            <Box component="nav" aria-label="منوی حساب" sx={{ display: "flex", alignItems: "center", gap: { xs: 1.5, sm: 2 }, mx: { xs: 1, sm: 2 } }}>
              <TextLink href="/dashboard">فروشگاه‌ها</TextLink>
              <TextLink href="/dashboard/account" title={user.name} sx={{ display: "inline-block", maxWidth: { xs: 84, sm: "none" }, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>
                {user.name}
              </TextLink>
            </Box>
            <LogoutButton />
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
