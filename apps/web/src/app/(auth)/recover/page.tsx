import type { Metadata } from "next";
import Typography from "@mui/material/Typography";
import RecoverForm from "@/components/RecoverForm";

export const metadata: Metadata = { title: "بازیابی حساب", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** MVP item 2: the recovery link from platform support (single use, 24 h). The token stays in this page only (no referrer). */
export default async function RecoverPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 800 }}>
        تعیین رمز عبور تازه
      </Typography>
      <RecoverForm token={typeof token === "string" ? token : ""} />
    </>
  );
}
