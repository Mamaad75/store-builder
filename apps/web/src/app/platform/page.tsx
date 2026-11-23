import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import { getPlatformOverview } from "@/gateway/platform";

const fa = (n: number) => n.toLocaleString("fa-IR");

export default async function PlatformHome() {
  const o = await getPlatformOverview();
  const items: [string, number][] = [
    ["کاربران", o.users],
    ["فروشگاه‌ها", o.stores],
    ["فروشگاه‌های منتشرشده", o.publishedStores],
    ["محصولات", o.products],
    ["مشتریان", o.customers],
  ];
  return (
    <>
      <Typography component="h1" variant="h5" sx={{ fontWeight: 800, mb: 3 }}>
        نمای کلی پلتفرم
      </Typography>
      <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0, display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
        {items.map(([label, value]) => (
          <li key={label}>
            <Card variant="outlined">
              <CardContent>
                <Typography sx={{ color: "text.secondary", fontSize: 14 }}>{label}</Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fa(value)}</Typography>
              </CardContent>
            </Card>
          </li>
        ))}
      </Box>
    </>
  );
}
