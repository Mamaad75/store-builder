import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import LogoutButton from "@/components/LogoutButton";
import { TextLink } from "@/components/NextLinks";
import SkipLink from "@/components/SkipLink";
import { RouterBridge } from "@/client/nav";
import { getPlatformRole } from "@/gateway/platform";
import { assertPlatformHost } from "@/lib/host-guard";
import { requireUser } from "@/modules/auth/session";
import ThemeRegistry from "@/theme/ThemeRegistry";

// Per-request: the session and the platform role are evaluated on the server for every page.
export const dynamic = "force-dynamic";
/** The title names the area only for a super admin: anyone else gets the plain 404 with nothing that reveals the area exists. */
export async function generateMetadata(): Promise<Metadata> {
  const role = await getPlatformRole().catch(() => null);
  return { robots: { index: false, follow: false }, ...(role === "SUPER_ADMIN" ? { title: "مدیریت پلتفرم" } : {}) };
}

/**
 * The super admin area (phase 3.1, D31-1). Separate from the merchant dashboard (which it does not touch). A signed-in user without the
 * platform role gets the ordinary 404: the area's existence is not revealed. The API re-checks the role on every call.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  await assertPlatformHost();
  const user = await requireUser();
  if ((await getPlatformRole()) !== "SUPER_ADMIN") notFound();
  return (
    <ThemeRegistry>
      <RouterBridge />
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
        <SkipLink />
        <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
          <Toolbar sx={{ gap: 2, flexWrap: "wrap" }}>
            <Typography component="p" sx={{ fontWeight: 800 }}>
              مدیریت پلتفرم
            </Typography>
            <Chip size="small" label="سوپرادمین" sx={{ bgcolor: "#7a2e00", color: "#fff", fontWeight: 700 }} />
            <Box component="nav" aria-label="منوی مدیریت پلتفرم" sx={{ display: "flex", gap: 2, flexGrow: 1, flexWrap: "wrap" }}>
              <TextLink href="/platform">نمای کلی</TextLink>
              <TextLink href="/platform/stores">فروشگاه‌ها</TextLink>
              <TextLink href="/platform/settings">تنظیمات</TextLink>
              <TextLink href="/platform/admins">مدیران</TextLink>
            </Box>
            <Typography component="span" sx={{ color: "text.secondary", fontSize: 14 }}>
              {user.name}
            </Typography>
            <LogoutButton />
          </Toolbar>
        </AppBar>
        <Box component="main" id="main" sx={{ maxWidth: 1100, mx: "auto", px: 2, py: 4 }}>
          {children}
        </Box>
      </Box>
    </ThemeRegistry>
  );
}
