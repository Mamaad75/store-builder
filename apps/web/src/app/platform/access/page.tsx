import type { Metadata } from "next";
import Typography from "@mui/material/Typography";
import AccessManager from "@/components/platform/AccessManager";
import { getPlatformSettings } from "@/gateway/platform";

export const metadata: Metadata = { title: "دسترسی و بازیابی" };

/** MVP item 2 (pilot access controls): registration mode, invitation codes, account recovery. */
export default async function PlatformAccessPage() {
  const v = await getPlatformSettings();
  return (
    <>
      <Typography component="h1" variant="h5" sx={{ fontWeight: 800, mb: 3 }}>
        دسترسی و بازیابی حساب
      </Typography>
      <AccessManager initialMode={v.settings.registration.mode} />
    </>
  );
}
