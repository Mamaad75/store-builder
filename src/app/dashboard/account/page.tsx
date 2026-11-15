import type { Metadata } from "next";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { ChangePasswordForm } from "@/components/AccountForms";
import { requireUser } from "@/modules/auth/session";
import { changePasswordAction, signOutEverywhereAction } from "./actions";

export const metadata: Metadata = { title: "حساب کاربری" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <Stack spacing={3} sx={{ maxWidth: 520 }}>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 800 }}>
        حساب کاربری
      </Typography>
      <Typography color="text.secondary" dir="ltr" sx={{ textAlign: "start" }}>
        {user.email}
      </Typography>
      <Paper variant="outlined" component="section" aria-labelledby="pw-h" sx={{ p: 3 }}>
        <Typography id="pw-h" variant="h6" component="h2" gutterBottom sx={{ fontWeight: 700 }}>
          تغییر رمز عبور
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          پس از تغییر، در همه دستگاه‌ها از حساب خارج می‌شوید و باید دوباره وارد شوید.
        </Typography>
        <ChangePasswordForm action={changePasswordAction} />
      </Paper>
      <Paper variant="outlined" component="section" aria-labelledby="so-h" sx={{ p: 3 }}>
        <Typography id="so-h" variant="h6" component="h2" gutterBottom sx={{ fontWeight: 700 }}>
          خروج از همه دستگاه‌ها
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          همه نشست‌های فعال شما، از جمله همین نشست، بسته می‌شوند.
        </Typography>
        <form action={signOutEverywhereAction}>
          <Button type="submit" variant="outlined" color="error">
            خروج از همه دستگاه‌ها
          </Button>
        </form>
      </Paper>
    </Stack>
  );
}
