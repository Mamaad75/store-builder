import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { TextLink } from "@/components/NextLinks";
import { getPlatformStores } from "@/gateway/platform";

const STATUS: Record<string, string> = { DRAFT: "پیش‌نویس", PUBLISHED: "منتشرشده", UNPUBLISHED: "غیرفعال" };

export default async function PlatformStores({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams;
  const rows = await getPlatformStores(typeof before === "string" && before.length <= 40 ? before : undefined);
  const next = rows.length === 50 ? rows[rows.length - 1]!.createdAt : null;
  return (
    <>
      <Typography component="h1" variant="h5" sx={{ fontWeight: 800, mb: 3 }}>
        همه‌ی فروشگاه‌ها
      </Typography>
      {rows.length === 0 ? (
        <Typography role="status">فروشگاهی پیدا نشد.</Typography>
      ) : (
        <TableContainer tabIndex={0} role="region" aria-label="جدول فروشگاه‌ها" sx={{ border: 1, borderColor: "divider", borderRadius: 2 }}>
          <Table size="small">
            <caption style={{ captionSide: "top", textAlign: "start", padding: 8 }}>جدیدترین‌ها اول</caption>
            <TableHead>
              <TableRow>
                <TableCell scope="col">نام</TableCell>
                <TableCell scope="col">مالک</TableCell>
                <TableCell scope="col">وضعیت</TableCell>
                <TableCell scope="col">زیردامنه</TableCell>
                <TableCell scope="col">محصولات</TableCell>
                <TableCell scope="col">ساخته‌شده</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell component="th" scope="row">{s.name}</TableCell>
                  <TableCell dir="ltr">{s.ownerUsername}</TableCell>
                  <TableCell>{STATUS[s.status] ?? s.status}</TableCell>
                  <TableCell dir="ltr">{s.subdomain ?? "—"}</TableCell>
                  <TableCell>{s.products.toLocaleString("fa-IR")}</TableCell>
                  <TableCell>{new Date(s.createdAt).toLocaleDateString("fa-IR")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {next && (
        <Typography sx={{ mt: 2 }}>
          <TextLink href={`/platform/stores?before=${encodeURIComponent(next)}`}>صفحه‌ی بعد</TextLink>
        </Typography>
      )}
    </>
  );
}
