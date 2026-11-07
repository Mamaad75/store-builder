"use client";

import { useActionState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { switchThemeAction } from "@/app/dashboard/actions";
import type { StoreFormState } from "@/app/dashboard/actions";
import type { EntryChange } from "@/modules/pages/compat";
import type { ThemeSwitchReport } from "@/modules/stores/theme-switch";

const CHANGE_LABEL: Record<EntryChange, string> = {
  stays_active: "فعال می‌ماند",
  becomes_dormant: "غیرفعال می‌شود (حفظ می‌شود، نمایش داده نمی‌شود)",
  becomes_active: "دوباره فعال می‌شود",
  stays_dormant: "غیرفعال می‌ماند",
  stays_invalid: "از قبل نامعتبر بود (تغییری نمی‌کند)",
  becomes_invalid: "با این قالب نامعتبر می‌شود — مانع تغییر",
  invalid_becomes_active: "نامعتبر بود؛ در قالب جدید فعال است",
  invalid_becomes_dormant: "نامعتبر بود؛ در قالب جدید غیرفعال است",
};

const PAGE_PATH: Record<string, string> = { HOME: "home", PRODUCTS: "products", PRODUCT_DETAIL: "product-detail", ABOUT: "about", CONTACT: "contact" };

export interface ThemeSwitchPanelProps {
  report: ThemeSwitchReport;
  /** Persian labels of the section types that occur in the report. */
  sectionLabels: Record<string, string>;
}

/** The compatibility report and the (only) confirmation form of a theme switch. Nothing is applied until it is submitted. */
export default function ThemeSwitchPanel({ report, sectionLabels }: ThemeSwitchPanelProps) {
  const [state, act, pending] = useActionState<StoreFormState, FormData>(switchThemeAction, {});
  const label = (t: string | null) => (t ? (sectionLabels[t] ?? t) : "نامشخص");
  const s = report.summary;
  const base = `/dashboard/stores/${encodeURIComponent(report.storeId)}/pages`;
  const changed = report.pages.map((p) => ({ ...p, entries: p.entries.filter((e) => e.change !== "stays_active") })).filter((p) => p.entries.length > 0 || p.missingRequired.length > 0);

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }} data-testid="theme-switch-panel" data-target={report.target.key} data-can-switch={report.canSwitch ? "yes" : "no"}>
      <Stack spacing={2}>
        <Typography variant="h6" component="h3">
          بررسی سازگاری: {report.current.name} ← {report.target.name}
        </Typography>
        <Alert severity="info">
          فقط قالب پیش‌نویس تغییر می‌کند. صفحه‌ها، بخش‌ها، محصولات، تصاویر و تنظیمات هیچ تغییری نمی‌کنند و فروشگاه منتشرشده (در صورت وجود) دست‌نخورده می‌ماند. بخش‌های ناسازگار فقط غیرفعال می‌شوند و با بازگشت به قالب سازگار دوباره ظاهر می‌شوند.
        </Alert>

        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }} data-testid="compat-summary">
          <Chip size="small" label={`فعال می‌مانند: ${s.stayActive.toLocaleString("fa-IR")}`} />
          <Chip size="small" color={s.becomeDormant ? "warning" : "default"} label={`غیرفعال می‌شوند: ${s.becomeDormant.toLocaleString("fa-IR")}`} data-testid="compat-become-dormant" />
          <Chip size="small" label={`دوباره فعال می‌شوند: ${s.becomeActive.toLocaleString("fa-IR")}`} />
          <Chip size="small" label={`از قبل غیرفعال: ${s.stayDormant.toLocaleString("fa-IR")}`} />
          <Chip size="small" label={`از قبل نامعتبر: ${s.preExistingInvalid.toLocaleString("fa-IR")}`} data-testid="compat-pre-invalid" />
          <Chip size="small" color={s.newInvalid ? "error" : "default"} label={`نامعتبر جدید: ${s.newInvalid.toLocaleString("fa-IR")}`} data-testid="compat-new-invalid" />
          <Chip size="small" color={s.missingRequired ? "error" : "default"} label={`بخش ضروری ناقص: ${s.missingRequired.toLocaleString("fa-IR")}`} data-testid="compat-missing-required" />
        </Stack>

        {!report.canSwitch && (
          <Alert severity="error" data-testid="compat-blocked">
            <Stack spacing={0.5}>
              <strong>تغییر قالب مسدود است. ابتدا موارد زیر را در قالب فعلی برطرف کنید؛ هیچ محتوایی خودکار تغییر نمی‌کند.</strong>
              {report.blockers.map((b, i) => (
                <span key={i} data-testid="compat-blocker" data-kind={b.kind}>
                  {b.kind === "new_invalid"
                    ? `صفحه «${report.pages.find((p) => p.type === b.pageType)?.title ?? b.pageType}»: بخش «${label(b.sectionType)}» در قالب جدید نامعتبر می‌شود. `
                    : `صفحه «${report.pages.find((p) => p.type === b.pageType)?.title ?? b.pageType}»: قالب جدید حداقل یک بخش «${label(b.sectionType)}» لازم دارد. `}
                  <a href={`${base}/${PAGE_PATH[b.pageType] ?? ""}`}>ویرایش صفحه</a>
                </span>
              ))}
            </Stack>
          </Alert>
        )}

        {changed.length === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="compat-nothing">
            هیچ بخشی با این تغییر عوض نمی‌شود.
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {changed.map((p) => (
              <Paper key={p.type} variant="outlined" sx={{ p: 1.5 }} data-testid="compat-page" data-page-type={p.type}>
                <Typography sx={{ fontWeight: 700 }}>{p.title}</Typography>
                <Stack component="ul" spacing={0.5} sx={{ m: 0, mt: 0.5, pl: 0, listStyle: "none" }}>
                  {p.entries.map((e) => (
                    <li key={e.index} data-testid="compat-entry" data-change={e.change} data-section-type={e.type ?? ""}>
                      <Typography variant="body2" color={e.blocking ? "error" : "text.primary"}>
                        {label(e.type)}
                        {e.hasImage ? " (دارای تصویر — حفظ می‌شود)" : ""}: {CHANGE_LABEL[e.change]}
                      </Typography>
                    </li>
                  ))}
                  {p.missingRequired.map((m) => (
                    <li key={m.type} data-testid="compat-missing" data-section-type={m.type}>
                      <Typography variant="body2" color="error">
                        بخش ضروری «{label(m.type)}» در این صفحه وجود ندارد{m.alsoMissingNow ? " (در قالب فعلی هم وجود ندارد)" : ""} — مانع تغییر
                      </Typography>
                    </li>
                  ))}
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}

        <form action={act}>
          <input type="hidden" name="storeId" value={report.storeId} />
          <input type="hidden" name="targetKey" value={report.target.key} />
          <input type="hidden" name="expectedDraftRevision" value={report.draftRevision} />
          <Stack spacing={1.5}>
            {state.error && <Alert severity="error" data-testid="switch-error">{state.error}</Alert>}
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
              <Button type="submit" variant="contained" disabled={pending || !report.canSwitch || report.sameTheme} data-testid="switch-theme-submit">
                تغییر قالب پیش‌نویس به «{report.target.name}»
              </Button>
              <Button component="a" href={`/preview/${encodeURIComponent(report.storeId)}?theme=${encodeURIComponent(report.target.key)}`} target="_blank" rel="noopener" variant="outlined" data-testid="switch-preview-link">
                پیش‌نمایش با داده‌های من
              </Button>
            </Stack>
          </Stack>
        </form>
      </Stack>
    </Paper>
  );
}
