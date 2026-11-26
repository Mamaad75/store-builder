import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { TextLink } from "@/components/NextLinks";

export default function SiteFooter() {
  return (
    <Box component="footer" data-print="hide" sx={{ borderTop: 1, borderColor: "divider", py: 3, mt: 6 }}>
      <Container>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
          <Typography variant="body2" color="text.secondary">
            سایت‌ساز فروشگاهی
          </Typography>
          <Stack component="nav" aria-label="پیوندهای پایین صفحه" direction="row" spacing={2}>
            <TextLink href="/terms">شرایط استفاده</TextLink>
            <TextLink href="/privacy">حریم خصوصی</TextLink>
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}
