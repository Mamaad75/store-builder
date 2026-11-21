import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import OpenInNewRounded from "@mui/icons-material/OpenInNewRounded";
import StorefrontOutlined from "@mui/icons-material/StorefrontOutlined";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Typography from "@mui/material/Typography";
import { LinkCardActionArea } from "@/components/NextLinks";

const STATUS = {
  DRAFT: { label: "پیش‌نویس", fg: "#475569", bg: "#eef2f7", dot: "#94a3b8" },
  PUBLISHED: { label: "منتشرشده", fg: "#166534", bg: "#dcfce7", dot: "#16a34a" },
  UNPUBLISHED: { label: "لغو انتشار", fg: "#92400e", bg: "#fef3c7", dot: "#f59e0b" },
} as const;

export interface StoreCardProps {
  id: string;
  name: string;
  status: keyof typeof STATUS;
  category: string;
  theme: string;
  /** The store's brand colour (a #rrggbb value) or null. */
  color: string | null;
  logoUrl: string | null;
}

/** One store of the owner: brand-coloured header, status, what it sells and which theme it uses; the whole card opens its admin. */
export default function StoreCard({ id, name, status, category, theme, color, logoUrl }: StoreCardProps) {
  const st = STATUS[status];
  const accent = color ?? "#4f46e5";
  return (
    <Card
      variant="outlined"
      sx={{ height: "100%", borderRadius: 4, overflow: "hidden", display: "flex", flexDirection: "column", transition: "box-shadow .2s, transform .2s, border-color .2s", "&:hover": { boxShadow: "0 12px 28px rgba(30,41,90,0.12)", transform: "translateY(-2px)", borderColor: accent } }}
    >
      <Box sx={{ height: 64, background: `linear-gradient(135deg, ${accent} 0%, ${accent}99 100%)` }} aria-hidden />
      <LinkCardActionArea href={`/dashboard/stores/${id}`} sx={{ flex: 1, px: 2.5, pb: 2, alignItems: "flex-start" }}>
        <Avatar src={logoUrl ?? undefined} alt="" variant="rounded" sx={{ width: 56, height: 56, mt: -3.5, mb: 1.5, border: "3px solid #fff", bgcolor: "#fff", color: accent, boxShadow: "0 4px 12px rgba(0,0,0,0.12)", fontWeight: 800 }}>
          {logoUrl ? null : <StorefrontOutlined />}
        </Avatar>
        <Typography sx={{ fontWeight: 800, fontSize: 18, lineHeight: 1.5 }}>{name}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {category}
          {" · "}
          قالب: {theme}
        </Typography>
        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, px: 1.25, py: 0.4, borderRadius: 5, bgcolor: st.bg, color: st.fg, fontSize: 13, fontWeight: 600 }}>
          <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: st.dot }} />
          {st.label}
        </Box>
      </LinkCardActionArea>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 2, py: 1, borderTop: "1px solid", borderColor: "divider", bgcolor: "#fafbff" }}>
        <Typography variant="body2" sx={{ color: accent === "#4f46e5" ? "primary.main" : "text.primary", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 0.5 }} aria-hidden>
          مدیریت فروشگاه <ArrowBackRounded sx={{ fontSize: 16 }} />
        </Typography>
        <Button component="a" href={`/preview/${encodeURIComponent(id)}`} target="_blank" rel="noopener" size="small" endIcon={<OpenInNewRounded sx={{ fontSize: 16 }} />} aria-label={`پیش‌نمایش پیش‌نویس ${name}`}>
          پیش‌نمایش
        </Button>
      </Box>
    </Card>
  );
}
