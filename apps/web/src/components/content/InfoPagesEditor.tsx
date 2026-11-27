"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { ANNOUNCEMENT_LINKS, ANNOUNCEMENT_LINK_LABELS, ANNOUNCEMENT_MAX, INFO_PAGE_KEYS, INFO_PAGE_LABELS, INFO_PAGE_MAX, INFO_PAGE_STARTERS, type Announcement, type AnnouncementLink, type InfoPageKey, type InfoPages } from "@store-builder/shared/modules/stores/info-pages";
import { updateStore } from "@/client/api";
import { failText } from "@/components/orders/labels";

type Msg = { ok: boolean; text: string } | null;
const SAVED = "ذخیره شد. برای دیدن در سایت، فروشگاه را از بخش «انتشار» منتشر کنید.";

/** The store's information pages (terms, shipping, returns, privacy, FAQ) and the announcement bar above every page. Plain text; live with the next publish. */
export default function InfoPagesEditor({ storeId, pages, announcement }: { storeId: string; pages: InfoPages; announcement: Announcement | null }) {
  const [saved, setSaved] = useState<InfoPages>(pages);
  const [draft, setDraft] = useState<InfoPages>(pages);
  const [tab, setTab] = useState<InfoPageKey>("terms");
  const [pageMsg, setPageMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [ann, setAnn] = useState<{ text: string; link: AnnouncementLink }>({ text: announcement?.text ?? "", link: announcement?.link ?? "none" });
  const [annSaved, setAnnSaved] = useState<Announcement | null>(announcement);
  const [annMsg, setAnnMsg] = useState<Msg>(null);

  const text = draft[tab] ?? "";
  const dirty = text.trim() !== (saved[tab] ?? "").trim();
  const has = (k: InfoPageKey) => (saved[k] ?? "").trim() !== "";

  async function savePage() {
    setBusy(true);
    setPageMsg(null);
    try {
      await updateStore(storeId, { infoPages: { [tab]: text } });
      setSaved((s) => ({ ...s, [tab]: text.trim() }));
      setDraft((d) => ({ ...d, [tab]: text.trim() }));
      setPageMsg({ ok: true, text: text.trim() === "" ? "صفحه حذف شد. تا انتشار بعدی هنوز در سایت می‌ماند." : SAVED });
    } catch (e) {
      setPageMsg({ ok: false, text: failText(e) });
    } finally {
      setBusy(false);
    }
  }
  async function saveAnn(remove: boolean) {
    setBusy(true);
    setAnnMsg(null);
    try {
      await updateStore(storeId, { announcement: remove ? null : { text: ann.text, link: ann.link } });
      setAnnSaved(remove ? null : { text: ann.text.trim(), link: ann.link });
      if (remove) setAnn({ text: "", link: "none" });
      setAnnMsg({ ok: true, text: remove ? "اعلان برداشته شد. تا انتشار بعدی هنوز در سایت می‌ماند." : SAVED });
    } catch (e) {
      setAnnMsg({ ok: false, text: failText(e) });
    } finally {
      setBusy(false);
    }
  }
  const annDirty = ann.text.trim() !== (annSaved?.text ?? "") || ann.link !== (annSaved?.link ?? "none");

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>قوانین و اطلاعات فروشگاه</Typography>
        <Typography variant="body2" color="text.secondary">
          صفحه‌هایی که خریدار پیش از خرید می‌خواهد (و اینماد هم معمولاً می‌خواهد). صفحهٔ خالی در سایت نیست؛ صفحهٔ پرشده با پیوند «قوانین و اطلاعات» پایین هر صفحه نمایش داده می‌شود. متن‌ها با «انتشار» فروشگاه زنده می‌شوند.
        </Typography>
      </Box>

      <Paper variant="outlined" component="section" aria-labelledby="pages-h" sx={{ p: { xs: 2, md: 3 } }}>
        <Typography id="pages-h" variant="subtitle1" component="h3" sx={{ fontWeight: 700, mb: 1 }}>صفحه‌ها</Typography>
        <Tabs value={tab} onChange={(_, v: InfoPageKey) => { setTab(v); setPageMsg(null); }} variant="scrollable" scrollButtons="auto" aria-label="صفحه‌های اطلاعاتی">
          {INFO_PAGE_KEYS.map((k) => <Tab key={k} value={k} label={INFO_PAGE_LABELS[k]} icon={has(k) ? <Chip size="small" color="success" label="دارد" /> : undefined} iconPosition="end" />)}
        </Tabs>
        <Box role="tabpanel" sx={{ mt: 2 }}>
          {pageMsg && <Alert severity={pageMsg.ok ? "success" : "error"} role={pageMsg.ok ? "status" : "alert"} sx={{ mb: 2 }}>{pageMsg.text}</Alert>}
          <TextField
            label={`متن «${INFO_PAGE_LABELS[tab]}»`}
            value={text}
            onChange={(e) => { setDraft((d) => ({ ...d, [tab]: e.target.value })); setPageMsg(null); }}
            multiline
            minRows={12}
            fullWidth
            slotProps={{ htmlInput: { maxLength: INFO_PAGE_MAX } }}
            helperText={tab === "faq" ? `هر پرسش را با «## » شروع کنید و پاسخش را زیرش بنویسید. ${text.length.toLocaleString("fa-IR")} از ${INFO_PAGE_MAX.toLocaleString("fa-IR")}` : `متن ساده: خطی که با «## » شروع شود تیتر است و خط خالی پاراگراف تازه می‌سازد. ${text.length.toLocaleString("fa-IR")} از ${INFO_PAGE_MAX.toLocaleString("fa-IR")}`}
          />
          <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap", gap: 1 }}>
            <Button variant="contained" onClick={savePage} disabled={busy || !dirty}>{busy ? "در حال ذخیره…" : text.trim() === "" && has(tab) ? "حذف صفحه" : "ذخیره"}</Button>
            {text.trim() === "" && <Button variant="outlined" onClick={() => setDraft((d) => ({ ...d, [tab]: INFO_PAGE_STARTERS[tab] }))}>درج متن پیشنهادی</Button>}
          </Stack>
          {text.trim() === "" && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>متن پیشنهادی عمومی است: آن را بخوانید، «…» را پر کنید و با شرایط واقعی فروشگاه خود هماهنگ کنید.</Typography>}
        </Box>
      </Paper>

      <Paper variant="outlined" component="section" aria-labelledby="ann-h" sx={{ p: { xs: 2, md: 3 } }}>
        <Typography id="ann-h" variant="subtitle1" component="h3" sx={{ fontWeight: 700, mb: 0.5 }}>اعلان بالای سایت</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>یک جملهٔ کوتاه (مثلاً «ارسال رایگان برای خرید بالای ۵۰۰ هزار تومان») که در نوار رنگی بالای همهٔ صفحه‌ها نمایش داده می‌شود.</Typography>
        {annMsg && <Alert severity={annMsg.ok ? "success" : "error"} role={annMsg.ok ? "status" : "alert"} sx={{ mb: 2 }}>{annMsg.text}</Alert>}
        <Stack spacing={2}>
          <TextField label="متن اعلان" value={ann.text} onChange={(e) => { setAnn((a) => ({ ...a, text: e.target.value })); setAnnMsg(null); }} fullWidth slotProps={{ htmlInput: { maxLength: ANNOUNCEMENT_MAX } }} helperText={`${ann.text.length.toLocaleString("fa-IR")} از ${ANNOUNCEMENT_MAX.toLocaleString("fa-IR")}`} />
          <TextField select label="پیوند اعلان" value={ann.link} onChange={(e) => { setAnn((a) => ({ ...a, link: e.target.value as AnnouncementLink })); setAnnMsg(null); }} sx={{ maxWidth: 320 }} helperText="فقط به صفحه‌های همین فروشگاه">
            {ANNOUNCEMENT_LINKS.map((l) => <MenuItem key={l} value={l}>{ANNOUNCEMENT_LINK_LABELS[l]}</MenuItem>)}
          </TextField>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={() => saveAnn(false)} disabled={busy || !ann.text.trim() || !annDirty}>ذخیرهٔ اعلان</Button>
            {annSaved && <Button color="error" onClick={() => saveAnn(true)} disabled={busy}>برداشتن اعلان</Button>}
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}
