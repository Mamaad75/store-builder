"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { POST_BODY_MAX, POST_EXCERPT_MAX, POST_STATUSES, POST_STATUS_LABELS, POST_TITLE_MAX, type PostStatus } from "@store-builder/shared/modules/blog/blog";
import { createBlogPost, deleteBlogPost, getBlogPost, updateBlogPost } from "@/client/api";
import { TextLink } from "@/components/NextLinks";
import { failText } from "@/components/orders/labels";

type Form = { title: string; excerpt: string; body: string; status: PostStatus };
const EMPTY: Form = { title: "", excerpt: "", body: "", status: "DRAFT" };

/** Writing or editing one post (`postId` null = a new one). Text only: a line starting with "## " is a heading, a blank line starts a paragraph. */
export default function PostEditor({ storeId, postId }: { storeId: string; postId: string | null }) {
  const router = useRouter();
  const back = `/dashboard/stores/${storeId}/blog`;
  const [form, setForm] = useState<Form | null>(postId ? null : EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!postId) return;
    let live = true;
    getBlogPost(storeId, postId)
      .then((p) => live && setForm({ title: p.title, excerpt: p.excerpt, body: p.body, status: p.status }))
      .catch((e) => live && setError(e instanceof Error && e.name === "NotFoundError" ? "این مقاله پیدا نشد." : failText(e)));
    return () => {
      live = false;
    };
  }, [storeId, postId]);

  const set = (patch: Partial<Form>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setSaved(false);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      if (postId) {
        await updateBlogPost(storeId, postId, form);
        setSaved(true);
      } else {
        const p = await createBlogPost(storeId, form);
        router.replace(`${back}/${p.id}`);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "ValidationError") setFieldErrors((err as Error & { fieldErrors?: Record<string, string[]> }).fieldErrors ?? {});
      else setError(failText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!postId) return;
    setBusy(true);
    try {
      await deleteBlogPost(storeId, postId);
      router.replace(back);
    } catch (err) {
      setConfirmDelete(false);
      setError(failText(err));
      setBusy(false);
    }
  }

  if (!form) return error ? <Alert severity="error">{error}</Alert> : <Skeleton variant="rounded" height={240} />;
  const fe = (k: string) => fieldErrors[k]?.[0];
  return (
    <Paper variant="outlined" component="form" onSubmit={submit} noValidate sx={{ p: { xs: 2, md: 3 } }}>
      <TextLink href={back} underline="hover" sx={{ display: "inline-block", mb: 1.5 }}>→ بازگشت به وبلاگ</TextLink>
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 2 }}>{postId ? "ویرایش مقاله" : "مقالهٔ تازه"}</Typography>
      {error && <Alert severity="error" role="alert" sx={{ mb: 2 }}>{error}</Alert>}
      {saved && <Alert severity="success" role="status" sx={{ mb: 2 }}>ذخیره شد. برای دیدن در سایت، فروشگاه را از بخش «انتشار» منتشر کنید.</Alert>}
      <Stack spacing={2.5}>
        <TextField label="عنوان" value={form.title} onChange={(e) => set({ title: e.target.value })} required fullWidth error={Boolean(fe("title"))} helperText={fe("title")} slotProps={{ htmlInput: { maxLength: POST_TITLE_MAX } }} />
        <TextField label="خلاصه (اختیاری)" value={form.excerpt} onChange={(e) => set({ excerpt: e.target.value })} fullWidth multiline minRows={2} error={Boolean(fe("excerpt"))} helperText={fe("excerpt") ?? "در فهرست مقاله‌ها و نتیجهٔ جستجو دیده می‌شود."} slotProps={{ htmlInput: { maxLength: POST_EXCERPT_MAX } }} />
        <TextField label="متن مقاله" value={form.body} onChange={(e) => set({ body: e.target.value })} required fullWidth multiline minRows={12} error={Boolean(fe("body"))} helperText={fe("body") ?? `متن ساده: یک خط که با «## » شروع شود تیتر است و یک خط خالی، پاراگراف تازه می‌سازد. ${form.body.length.toLocaleString("fa-IR")} از ${POST_BODY_MAX.toLocaleString("fa-IR")}`} slotProps={{ htmlInput: { maxLength: POST_BODY_MAX } }} />
        <TextField select label="وضعیت" value={form.status} onChange={(e) => set({ status: e.target.value as PostStatus })} sx={{ maxWidth: 280 }} helperText={form.status === "PUBLISHED" ? "با «انتشار» فروشگاه در سایت دیده می‌شود." : "فقط برای شما؛ در سایت نیست."}>
          {POST_STATUSES.map((s) => <MenuItem key={s} value={s}>{POST_STATUS_LABELS[s]}</MenuItem>)}
        </TextField>
        <Stack direction="row" spacing={1.5} sx={{ justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
          <Button type="submit" variant="contained" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیره"}</Button>
          {postId && <Button color="error" disabled={busy} onClick={() => setConfirmDelete(true)}>حذف مقاله</Button>}
        </Stack>
      </Stack>
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} aria-labelledby="del-post-h">
        <DialogTitle id="del-post-h">حذف مقاله؟</DialogTitle>
        <DialogContent><DialogContentText>«{form.title}» برای همیشه حذف می‌شود. اگر منتشر شده باشد، تا انتشار بعدی فروشگاه هنوز در سایت می‌ماند.</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>انصراف</Button>
          <Button color="error" onClick={remove} disabled={busy}>حذف</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
