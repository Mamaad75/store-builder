import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import ThemeRegistry from "@/theme/ThemeRegistry";

// Placeholder only. The real landing page is built in a later step.
export default function HomePage() {
  return (
    <ThemeRegistry>
      <Container maxWidth="sm" sx={{ py: 12 }}>
        <Stack spacing={2} sx={{ alignItems: "center", textAlign: "center" }}>
          <Typography variant="h3" component="h1" sx={{ fontWeight: 800 }}>
            سایت‌ساز فروشگاهی
          </Typography>
          <Typography color="text.secondary">پلتفرم در حال ساخت است. این صفحه فقط برای بررسی اسکلت پروژه است.</Typography>
        </Stack>
      </Container>
    </ThemeRegistry>
  );
}
