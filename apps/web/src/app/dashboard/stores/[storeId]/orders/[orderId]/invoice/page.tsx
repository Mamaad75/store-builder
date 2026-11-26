import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { TextLink } from "@/components/NextLinks";
import PrintButton from "@/components/orders/PrintButton";
import { getOrderView } from "@/gateway/orders";
import { getStore } from "@/gateway/stores";
import { requireUser } from "@/modules/auth/session";
import { provinceName } from "@store-builder/shared/modules/checkout/provinces";
import { formatIranMobile } from "@store-builder/shared/lib/phone";
import { ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS } from "@store-builder/shared/modules/orders/orders";
import { PermissionDeniedError } from "@store-builder/shared/modules/access/errors";
import { NotFoundError } from "@store-builder/shared/modules/stores/errors";
import { templateSettingsSchema } from "@store-builder/shared/templates/sections";

export const metadata: Metadata = { title: "فاکتور سفارش" };
export const dynamic = "force-dynamic";

const fa = (n: number) => n.toLocaleString("fa-IR");
const toman = (n: number) => `${fa(n)} تومان`;
const PRINT_CSS = `
@page { margin: 12mm; }
@media print {
  [data-print="hide"] { display: none !important; }
  body { background: #fff !important; }
  main, [data-testid="store-content"] { padding: 0 !important; max-width: none !important; }
  [data-testid="invoice"] { border: 0 !important; box-shadow: none !important; padding: 0 !important; }
}`;

/**
 * A printable invoice (default) or packing slip (`?view=packing`: no prices, a tick box per line) for one order. The panel's menus are hidden
 * when printing; "print" in the browser can also save a PDF. Owner and manager only (the order has the buyer's name, phone and address).
 */
export default async function InvoicePage({ params, searchParams }: { params: Promise<{ storeId: string; orderId: string }>; searchParams: Promise<{ view?: string }> }) {
  await requireUser();
  const { storeId, orderId } = await params;
  const packing = (await searchParams).view === "packing";
  let order, store;
  try {
    [order, store] = await Promise.all([getOrderView(storeId, orderId), getStore(storeId)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof PermissionDeniedError) return <Alert severity="info">فاکتور و برگهٔ بسته‌بندی فقط برای مالک و مدیر فروشگاه است.</Alert>;
    throw e;
  }
  const contact = templateSettingsSchema.parse(store.settings).contact;
  const a = order.address;
  const back = `/dashboard/stores/${encodeURIComponent(storeId)}/orders/${encodeURIComponent(orderId)}`;
  const date = new Date(order.createdAt).toLocaleDateString("fa-IR", { dateStyle: "long", timeZone: "Asia/Tehran" });
  const title = packing ? "برگهٔ بسته‌بندی" : "فاکتور فروش";
  const th = { textAlign: "start" as const, padding: "6px 8px", borderBottom: "2px solid #444" };
  const td = { padding: "6px 8px", borderBottom: "1px solid #ccc", verticalAlign: "top" as const };
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <style>{PRINT_CSS}</style>
      <Box data-print="hide" sx={{ display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
        <PrintButton label={packing ? "چاپ برگهٔ بسته‌بندی" : "چاپ فاکتور"} />
        <TextLink href={packing ? `${back}/invoice` : `${back}/invoice?view=packing`}>{packing ? "نمایش فاکتور" : "نمایش برگهٔ بسته‌بندی (بدون قیمت)"}</TextLink>
        <TextLink href={back}>بازگشت به سفارش</TextLink>
      </Box>

      <Paper variant="outlined" data-testid="invoice" component="article" aria-label={`${title} شمارهٔ ${fa(order.number)}`} sx={{ p: { xs: 2, md: 4 }, borderRadius: 2, bgcolor: "#fff" }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, flexWrap: "wrap", mb: 3 }}>
          <Box>
            <Typography component="h2" variant="h5" sx={{ fontWeight: 800 }}>{store.name}</Typography>
            {contact.phone && <Typography variant="body2">تلفن: <span dir="ltr">{contact.phone}</span></Typography>}
            {contact.email && <Typography variant="body2">ایمیل: <span dir="ltr">{contact.email}</span></Typography>}
            {contact.address && <Typography variant="body2">نشانی: {contact.address}</Typography>}
          </Box>
          <Box sx={{ textAlign: { sm: "end" } }}>
            <Typography component="h3" variant="h6" sx={{ fontWeight: 800 }}>{title}</Typography>
            <Typography variant="body2" data-testid="invoice-number">شمارهٔ سفارش: <strong>{fa(order.number)}</strong></Typography>
            <Typography variant="body2">تاریخ: {date}</Typography>
            <Typography variant="body2">وضعیت: {ORDER_STATUS_LABELS[order.status]}</Typography>
          </Box>
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography component="h3" sx={{ fontWeight: 700, mb: 0.5 }}>تحویل به</Typography>
          <Typography>{a.recipientName} — <span dir="ltr">{formatIranMobile(a.phone)}</span></Typography>
          <Typography>{provinceName(a.province) ?? a.province}، {a.city}، {a.line}</Typography>
          <Typography variant="body2">کد پستی: <span dir="ltr">{a.postalCode}</span></Typography>
          <Typography variant="body2">روش ارسال: {order.shipping.name}{order.trackingCode ? <> — کد رهگیری: <span dir="ltr">{order.trackingCode}</span></> : null}</Typography>
          {order.note && <Typography variant="body2">یادداشت خریدار: {order.note}</Typography>}
        </Box>

        <Box sx={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }} aria-label="کالاهای سفارش">
            <thead>
              <tr>
                {packing && <th scope="col" style={{ ...th, width: 28 }}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>آماده</span></th>}
                <th scope="col" style={th}>کالا</th>
                <th scope="col" style={th}>تعداد</th>
                {!packing && <th scope="col" style={th}>قیمت واحد</th>}
                {!packing && <th scope="col" style={th}>جمع</th>}
              </tr>
            </thead>
            <tbody>
              {order.items.map((i, n) => (
                <tr key={n}>
                  {packing && <td style={td} aria-hidden>☐</td>}
                  <td style={td}>{i.name}{i.variantLabel ? ` (${i.variantLabel})` : ""}</td>
                  <td style={td}>{fa(i.quantity)}</td>
                  {!packing && <td style={td}>{toman(i.unitPrice)}</td>}
                  {!packing && <td style={td}>{toman(i.lineTotal)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Box>

        {!packing && (
          <Box component="dl" data-testid="invoice-totals" sx={{ display: "grid", gridTemplateColumns: "1fr auto", columnGap: 3, rowGap: 0.5, m: 0, mt: 2, maxWidth: 420, marginInlineStart: "auto" }}>
            <dt>جمع کالاها</dt><dd style={{ margin: 0 }}>{toman(order.subtotal)}</dd>
            <dt>هزینهٔ ارسال</dt><dd style={{ margin: 0 }}>{toman(order.shipping.cost)}</dd>
            {order.codFee > 0 && (<><dt>هزینهٔ پرداخت در محل</dt><dd style={{ margin: 0 }}>{toman(order.codFee)}</dd></>)}
            {order.discountAmount > 0 && (<><dt>تخفیف{order.discountCode ? ` (${order.discountCode})` : ""}</dt><dd style={{ margin: 0 }}>−{toman(order.discountAmount)}</dd></>)}
            <dt style={{ fontWeight: 800, borderTop: "2px solid #444", paddingTop: 6 }}>مبلغ نهایی</dt>
            <dd style={{ margin: 0, fontWeight: 800, borderTop: "2px solid #444", paddingTop: 6 }}>{toman(order.total)}</dd>
            <dt>روش پرداخت</dt><dd style={{ margin: 0 }}>{PAYMENT_METHOD_LABELS[order.paymentMethod]}</dd>
          </Box>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 4, textAlign: "center" }}>{packing ? "پس از بسته‌بندی، هر کالا را تیک بزنید." : "از خرید شما سپاسگزاریم."}</Typography>
      </Paper>
    </Box>
  );
}
