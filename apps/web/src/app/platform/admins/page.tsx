import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { GrantAdminForm, RevokeAdminButton } from "@/components/platform/PlatformForms";
import { getPlatformAdmins } from "@/gateway/platform";
import { requireUser } from "@/modules/auth/session";

export default async function PlatformAdminsPage() {
  const [me, admins] = await Promise.all([requireUser(), getPlatformAdmins()]);
  return (
    <>
      <Typography component="h1" variant="h5" sx={{ fontWeight: 800, mb: 1 }}>
        مدیران پلتفرم
      </Typography>
      <Typography sx={{ color: "text.secondary", mb: 3 }}>
        هر حساب کاربری موجود را می‌توانید سوپرادمین کنید. حذف دسترسی فوری است؛ خودتان و آخرین مدیر را نمی‌توان حذف کرد. همه‌ی تغییرها در گزارش فعالیت ثبت می‌شوند.
      </Typography>
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography component="h2" variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
            افزودن مدیر
          </Typography>
          <GrantAdminForm />
        </CardContent>
      </Card>
      <Table size="small" sx={{ border: 1, borderColor: "divider" }}>
        <TableHead>
          <TableRow>
            <TableCell scope="col">نام</TableCell>
            <TableCell scope="col">نام کاربری</TableCell>
            <TableCell scope="col">از تاریخ</TableCell>
            <TableCell scope="col">
              <Box component="span" sx={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
                کارها
              </Box>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {admins.map((a) => (
            <TableRow key={a.userId}>
              <TableCell component="th" scope="row">{a.name}</TableCell>
              <TableCell dir="ltr">{a.username}</TableCell>
              <TableCell>{new Date(a.grantedAt).toLocaleDateString("fa-IR")}</TableCell>
              <TableCell>
                <RevokeAdminButton userId={a.userId} username={a.username} self={a.userId === me.id} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
