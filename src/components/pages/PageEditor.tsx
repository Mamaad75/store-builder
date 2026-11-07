"use client";

import { useActionState, useState } from "react";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { pageEditAction, type EditorState } from "@/app/dashboard/pages-actions";
import { removeSectionImageAction, uploadSectionImageAction } from "@/app/dashboard/media-actions";
import ImageUploader from "@/components/ImageUploader";
import { SECTION_LABELS } from "@/templates/section-defaults";
import { IMAGE_SECTION_TYPES, LINK_TARGETS, SECTION_FIELDS, type FieldSpec } from "@/templates/section-fields";
import type { Section } from "@/templates/sections";

/** Plain, serialisable view of the page (built on the server). */
export interface PageEditorProps {
  storeId: string;
  pageType: string;
  title: string;
  revision: number;
  isVisible: boolean;
  canHide: boolean;
  sections: Section[];
  issues: { index: number; reason: string; preview: string }[];
  archivedCount: number;
  allowed: string[];
  singletons: string[];
  required: string[];
  maxSections: number;
  /** Public URL, width and height of each section image (by media id), built on the server. */
  imageUrls: Record<string, { url: string; width: number; height: number }>;
}

const REASON_LABEL: Record<string, string> = {
  not_an_array: "ساختار صفحه آرایه نیست",
  invalid_envelope: "بخش ناقص یا تکراری",
  unsupported_type: "نوع بخش ناشناخته",
  invalid_props: "مقادیر نامعتبر",
  not_allowed: "این بخش برای قالب فعلی مجاز نیست",
  duplicate_singleton: "نسخهٔ اضافی بخش یگانه",
};

function Field({ spec, value, error }: { spec: FieldSpec; value: unknown; error?: string }) {
  const name = `f_${spec.name}`;
  if (spec.kind === "link") {
    const v = typeof value === "string" ? value : "/";
    const known = LINK_TARGETS.some((t) => t.path === v);
    return (
      <TextField select name={name} label={spec.label} defaultValue={v} size="small" error={!!error} helperText={error} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
        {!known && <option value={v}>{v}</option>}
        {LINK_TARGETS.map((t) => (
          <option key={t.path} value={t.path}>
            {t.label}
          </option>
        ))}
      </TextField>
    );
  }
  return (
    <TextField
      name={name}
      label={spec.label}
      defaultValue={value === null || value === undefined ? "" : String(value)}
      size="small"
      multiline={spec.kind === "textarea"}
      minRows={spec.kind === "textarea" ? 3 : undefined}
      error={!!error}
      helperText={error ?? spec.help}
      slotProps={{ htmlInput: { ...(spec.max && spec.kind !== "number" ? { maxLength: spec.max } : {}), ...(spec.kind === "number" ? { inputMode: "numeric" as const, dir: "ltr" as const } : {}) } }}
    />
  );
}

function HiddenFields({ base, intent, sectionId }: { base: Record<string, string>; intent: string; sectionId?: string }) {
  return (
    <>
      {Object.entries(base).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="intent" value={intent} />
      {sectionId && <input type="hidden" name="sectionId" value={sectionId} />}
    </>
  );
}

export default function PageEditor(p: PageEditorProps) {
  const [state, act, pending] = useActionState<EditorState, FormData>(pageEditAction, {});
  const [newType, setNewType] = useState("");
  const blocked = p.issues.length > 0;
  const hidden = { storeId: p.storeId, pageType: p.pageType, expectedRevision: String(p.revision) };
  const addable = p.allowed.filter((t) => !(p.singletons.includes(t) && p.sections.some((s) => s.type === t)));
  const atLimit = p.sections.length >= p.maxSections;

  return (
    <Stack spacing={2.5} data-testid="page-editor">
      {state.error && !state.sectionId && <Alert severity="error">{state.error}</Alert>}
      {state.success && <Alert severity="success">{state.success}</Alert>}

      {blocked && (
        <Alert severity="warning" data-testid="recovery-panel" sx={{ alignItems: "flex-start" }}>
          <Stack spacing={1.5}>
            <Typography sx={{ fontWeight: 700 }}>این صفحه {p.issues.length.toLocaleString("fa-IR")} بخش نامعتبر یا ناشناخته دارد و ویرایش آن فعلاً قفل است.</Typography>
            <Typography variant="body2">
              بخش‌های زیر در فروشگاه نمایش داده نمی‌شوند. با «انتقال به بایگانی» همین بخش‌ها بدون هیچ تغییری در بایگانی همین صفحه نگه داشته می‌شوند و بقیهٔ بخش‌ها قابل ویرایش می‌شوند. هیچ داده‌ای حذف نمی‌شود.
            </Typography>
            <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
              {p.issues.map((i, k) => (
                <li key={k}>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {REASON_LABEL[i.reason] ?? i.reason}
                  </Typography>
                  <Box component="pre" dir="ltr" sx={{ m: 0, mb: 1, p: 1, bgcolor: "action.hover", borderRadius: 1, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                    {i.preview}
                  </Box>
                </li>
              ))}
            </Box>
            <form action={act}>
              <HiddenFields base={hidden} intent="recover" />
              <Button type="submit" variant="contained" color="warning" size="small" disabled={pending}>
                انتقال به بایگانی و ادامه
              </Button>
            </form>
          </Stack>
        </Alert>
      )}

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
        <Typography variant="body2" color="text.secondary">
          {p.sections.length.toLocaleString("fa-IR")} از {p.maxSections.toLocaleString("fa-IR")} بخش
          {p.archivedCount > 0 && ` · ${p.archivedCount.toLocaleString("fa-IR")} مورد بایگانی‌شده`}
        </Typography>
        <form action={act}>
          <HiddenFields base={hidden} intent="visibility" />
          <input type="hidden" name="visible" value={p.isVisible ? "false" : "true"} />
          <Button type="submit" size="small" variant="outlined" disabled={pending || !p.canHide || blocked} data-testid="visibility-toggle">
            {p.isVisible ? "پنهان‌کردن صفحه" : "نمایش صفحه"}
          </Button>
          {!p.canHide && (
            <Typography variant="caption" color="text.secondary" sx={{ ms: 1 }}>
              {" "}
              این صفحه همیشه نمایش داده می‌شود.
            </Typography>
          )}
        </form>
      </Stack>

      <Stack spacing={1.5}>
        {p.sections.map((s, i) => {
          const fields = SECTION_FIELDS[s.type];
          const required = p.required.includes(s.type) && p.sections.filter((x) => x.type === s.type).length === 1;
          const imageId = "imageId" in s.props ? s.props.imageId : null;
          const img = imageId ? p.imageUrls[imageId] : undefined;
          const fieldErrors = state.sectionId === s.id ? state.fieldErrors : undefined;
          return (
            <Accordion key={s.id} variant="outlined" disableGutters data-testid="section-card" data-section-type={s.type} defaultExpanded={state.sectionId === s.id && !!state.error}>
              <AccordionSummary aria-label={`${SECTION_LABELS[s.type]} (${(i + 1).toLocaleString("fa-IR")})`}>
                <Typography sx={{ fontWeight: 700 }}>
                  {(i + 1).toLocaleString("fa-IR")}. {SECTION_LABELS[s.type]}
                </Typography>
                {"title" in s.props && s.props.title && (
                  <Typography color="text.secondary" sx={{ mx: 1.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: { xs: 120, sm: 320 } }}>
                    {s.props.title}
                  </Typography>
                )}
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  {state.error && state.sectionId === s.id && <Alert severity="error">{state.error}</Alert>}
                  {fields.length > 0 ? (
                    <form key={`${s.id}-${p.revision}`} action={act}>
                      <HiddenFields base={hidden} intent="update" sectionId={s.id} />
                      <Stack spacing={2}>
                        {fields.map((f) => (
                          <Field key={f.name} spec={f} value={(s.props as Record<string, unknown>)[f.name]} error={fieldErrors?.[f.name]?.[0]} />
                        ))}
                        <Box>
                          <Button type="submit" variant="contained" size="small" disabled={pending || blocked}>
                            ذخیرهٔ بخش
                          </Button>
                        </Box>
                      </Stack>
                    </form>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      این بخش تنظیم خاصی ندارد.
                    </Typography>
                  )}
                  {IMAGE_SECTION_TYPES.includes(s.type) && (
                    <ImageUploader
                      title="تصویر بخش"
                      help="JPEG، PNG یا WebP؛ حداکثر ۵ مگابایت. هر کسی که نشانی تصویر را داشته باشد می‌تواند آن را ببیند."
                      testId={`section-image-${s.id}`}
                      hidden={{ ...hidden, sectionId: s.id }}
                      imageUrl={img?.url ?? null}
                      image={img ? { width: img.width, height: img.height } : null}
                      uploadAction={uploadSectionImageAction}
                      removeAction={removeSectionImageAction}
                    />
                  )}
                  <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                    <form action={act}>
                      <HiddenFields base={hidden} intent="up" sectionId={s.id} />
                      <Button type="submit" size="small" variant="outlined" disabled={pending || blocked || i === 0} aria-label={`بالا بردن ${SECTION_LABELS[s.type]}`}>
                        ↑ بالا
                      </Button>
                    </form>
                    <form action={act}>
                      <HiddenFields base={hidden} intent="down" sectionId={s.id} />
                      <Button type="submit" size="small" variant="outlined" disabled={pending || blocked || i === p.sections.length - 1} aria-label={`پایین بردن ${SECTION_LABELS[s.type]}`}>
                        ↓ پایین
                      </Button>
                    </form>
                    <form action={act}>
                      <HiddenFields base={hidden} intent="remove" sectionId={s.id} />
                      <Button type="submit" size="small" color="error" disabled={pending || blocked || required} title={required ? "این بخش برای عملکرد صفحه لازم است" : undefined}>
                        حذف بخش
                      </Button>
                    </form>
                  </Stack>
                </Stack>
              </AccordionDetails>
            </Accordion>
          );
        })}
        {p.sections.length === 0 && !blocked && <Alert severity="info">این صفحه هنوز بخشی ندارد.</Alert>}
      </Stack>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <form action={act}>
          <HiddenFields base={hidden} intent="add" />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
            <TextField
              select
              name="sectionType"
              label="افزودن بخش"
              size="small"
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              disabled={blocked || atLimit || addable.length === 0}
              sx={{ minWidth: 220 }}
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
            >
              <option value="">انتخاب کنید…</option>
              {addable.map((t) => (
                <option key={t} value={t}>
                  {SECTION_LABELS[t as Section["type"]]}
                </option>
              ))}
            </TextField>
            <Button type="submit" variant="contained" size="small" disabled={pending || blocked || atLimit || !newType}>
              افزودن
            </Button>
            {atLimit && (
              <Typography variant="caption" color="text.secondary">
                به حداکثر تعداد بخش رسیده‌اید.
              </Typography>
            )}
          </Stack>
        </form>
      </Paper>
    </Stack>
  );
}
