"use client";

import { useEffect, useState } from "react";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import RadioButtonUncheckedRounded from "@mui/icons-material/RadioButtonUncheckedRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { LinkButton } from "@/components/NextLinks";
import { getSetup, type StoreSetup } from "@/client/api";
import { SETUP_ITEM_TEXT } from "@store-builder/shared/modules/stores/setup";

const fa = (n: number) => n.toLocaleString("fa-IR");

/**
 * MVP item 3: what is still missing before shoppers can finish an order. The rules come from the API (shared/modules/stores/setup.ts);
 * this only shows them. Hidden when everything is done, and for roles that may not change settings (the API answers 403).
 */
export default function StoreSetupChecklist({ storeId }: { storeId: string }) {
  const [data, setData] = useState<StoreSetup | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let live = true;
    getSetup(storeId)
      .then((d) => live && setData(d))
      .catch(() => live && setHidden(true)); // no permission, or a transient failure: the dashboard works without it
    return () => {
      live = false;
    };
  }, [storeId]);

  if (hidden || !data || data.complete) return null;
  const done = data.items.filter((i) => i.done).length;
  const base = `/dashboard/stores/${encodeURIComponent(storeId)}`;
  const payment = data.items.find((i) => i.key === "payment");
  return (
    <Paper variant="outlined" component="section" aria-labelledby="setup-h" data-testid="setup-checklist" sx={{ p: { xs: 2, md: 3 }, borderColor: "warning.light" }}>
      <Typography id="setup-h" variant="h6" component="h2" sx={{ fontWeight: 700 }}>آماده‌سازی فروشگاه برای فروش</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {fa(done)} از {fa(data.items.length)} مورد انجام شده است. تا این موارد کامل نشود، خریدار ممکن است نتواند سفارش را تمام کند.
      </Typography>
      {payment && !payment.done && (
        <Alert severity="warning" sx={{ mb: 2 }}>هنوز هیچ روش پرداختی فعال نیست؛ خریدار در صفحهٔ خرید نمی‌تواند پرداخت را انتخاب کند.</Alert>
      )}
      <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.5 }}>
        {data.items.map((i) => {
          const t = SETUP_ITEM_TEXT[i.key];
          return (
            <Box key={i.key} component="li" data-step={i.key} data-done={i.done} sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              {i.done ? <CheckCircleRounded color="success" aria-hidden /> : <RadioButtonUncheckedRounded color="disabled" aria-hidden />}
              <Box sx={{ flex: 1, minWidth: 200 }}>
                <Typography sx={{ fontWeight: 600 }}>
                  {t.label}
                  <Box component="span" sx={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>{i.done ? " (انجام شد)" : " (انجام نشده)"}</Box>
                </Typography>
                {!i.done && <Typography variant="body2" color="text.secondary">{t.hint}</Typography>}
              </Box>
              {!i.done && <LinkButton href={`${base}${t.path}`} size="small" variant="outlined">انجام بده</LinkButton>}
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}
