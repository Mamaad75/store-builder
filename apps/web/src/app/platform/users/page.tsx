import type { Metadata } from "next";
import Typography from "@mui/material/Typography";
import AccountsList from "@/components/platform/AccountsList";
import { requireUser } from "@/modules/auth/session";

export const metadata: Metadata = { title: "کاربران" };

export default async function UsersPage() {
  await requireUser();
  return (
    <>
      <Typography component="h1" variant="h5" sx={{ fontWeight: 800, mb: 2 }}>کاربران</Typography>
      <AccountsList />
    </>
  );
}
