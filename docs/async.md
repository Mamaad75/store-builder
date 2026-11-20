# کار ناهمگام: Outbox، صف و Worker (فاز ۲.۲ — ADR 0002 §۲.۸)

## چرا
کارهایی مثل پیامک، ایمیل، به‌روزرسانی فید ترب و ایمالز، و پاک کردن کش ویترین نباید درخواست کاربر را کند کنند یا با قطع یک سرویس بیرونی خراب شوند.
اما «انجام بعداً» نباید یعنی «گاهی گم شدن». **الگوی Outbox** این دو را با هم تضمین می‌کند.

## جریان
```
تراکنش کسب‌وکار (مثلاً انتشار فروشگاه)
  └─ recordEvent(ctx, {type:"store.published", ...})  → ردیف OutboxEvent در همان تراکنش (commit با هم، rollback با هم)
Worker (فرایند جدا)
  ├─ relay: claim (FOR UPDATE SKIP LOCKED + lease) → BullMQ queue.add(jobId = id رویداد) → publishedAt
  └─ consumer: صف domain-events → handler مربوط به type (worker/handlers.ts)
```

* **API به Valkey وابسته نیست:** API فقط ردیف outbox می‌نویسد. اگر Valkey یا worker قطع باشد، رویدادها در PostgreSQL می‌مانند و بعد از برگشتن
  تحویل می‌شوند (تست «events written while the worker is down»).
* **تحویل «دست‌کم یک بار» و بدون ترتیب:** هر consumer باید **idempotent** باشد و `event.id` را کلید قرار دهد. ارسال دوباره‌ی یک رویداد
  (crash بین add و ثبت publishedAt) را خود صف با `jobId` تکراری نادیده می‌گیرد (۲۴ ساعت نگه‌داری job تمام‌شده).
* **تلاش دوباره:**
  * relay → صف: backoff نمایی ۱ ثانیه تا ۵ دقیقه؛ در تلاش دهم یک هشدار بله (`outbox.stuck`) و تلاش ادامه دارد.
  * صف → consumer: ۸ تلاش با backoff نمایی از ۵ ثانیه؛ بعد از آخرین شکست یک هشدار بله (`event.dead`). job شکست‌خورده ۱۴ روز در Valkey می‌ماند.
* **امنیت:** payload فقط شناسه‌ها و واقعیت‌های کوچک (حداکثر ۸KB)، بدون اطلاعات شخصی یا راز؛ consumer وضعیت فعلی را خودش از پایگاه‌داده می‌خواند.
  در لاگ و `lastError` فقط **نوع خطا** ثبت می‌شود، نه پیام آن (پیام ممکن است آدرس یا رمز اتصال داشته باشد). `REDIS_URL` هرگز لاگ نمی‌شود و در
  production بدون رمز پذیرفته نمی‌شود.

## اضافه کردن رویداد جدید
1. نام: `<context>.<event>` با حروف کوچک (هم در کد و هم با CHECK پایگاه‌داده اجبار می‌شود).
2. در همان تراکنش تغییر: `recordEvent(ctx, { type, storeId, payload })` (`platform/outbox/outbox.ts`). ماژول لایه‌ای این را از طریق یک port در
   Unit of Work خودش انجام می‌دهد، نه مستقیم در application.
3. consumer را در `src/worker/handlers.ts` ثبت کنید، idempotent، با تست.

## اجرای محلی (بدون هیچ سرور بیرونی)
```bash
pnpm db:up                      # PostgreSQL + MinIO + Valkey (Valkey از mirror داخلی docker.arvancloud.ir هم می‌آید)
pnpm db:deploy                  # migration جدول OutboxEvent
pnpm worker                     # relay + consumerها؛ Ctrl+C برای توقف تمیز
pnpm test:queue                 # تست یکپارچه با Valkey واقعی (REDIS_URL پیش‌فرض redis://localhost:6379)
```
اگر پورت 6379 گرفته است: `VALKEY_HOST_PORT=16379 pnpm db:up` و `REDIS_URL=redis://localhost:16379`.

## میزبانی در ایران
* Valkey (مجوز BSD، سازگار با Redis) **خودمیزبان** داخل همان compose است؛ به هیچ سرویس مدیریت‌شده‌ی خارجی وابسته نیست. image از mirror
  داخلی گرفته می‌شود و در production با digest سنجاق می‌شود.
* اگر بعداً سرویس‌دهنده‌ی ایرانی (مثلاً ParsPack) Redis مدیریت‌شده داد، فقط `REDIS_URL` عوض می‌شود؛ کد تغییری نمی‌کند.
* ماندگاری: AOF روشن است تا jobهای صف بعد از restart بمانند؛ `maxmemory-policy noeviction` الزام BullMQ است. منبع حقیقت رویدادها
  PostgreSQL است (که پشتیبان‌گیری می‌شود)، پس از دست رفتن Valkey فقط تحویل را عقب می‌اندازد، رویدادی گم نمی‌شود مگر jobهایی که
  وسط پردازش بودند و consumer آن‌ها هنوز تمام نشده بود.

## وضعیت
* **۲.۲a (انجام شد):** جدول OutboxEvent، recordEvent، relay، صف BullMQ روی Valkey، فرایند worker، رویداد `store.published`، تست‌ها و گاردها.
* **۲.۲b (انجام شد):** کارهای دوره‌ای (`media-cleanup` هر ۳۰ دقیقه، `db-cleanup` هر ۱۵ دقیقه) حالا Job Scheduler صف `maintenance` هستند
  (همزمانی سراسری ۱: حتی با چند worker هیچ اجرایی با دیگری هم‌پوشانی ندارد)؛ `db-cleanup` رویدادهای منتشرشده‌ی قدیمی‌تر از ۷ روز را پاک می‌کند
  (منتشرنشده‌ها هرگز)؛ در `docker-compose.prod.yml` سرویس‌های `valkey` (رمز از محیط، فقط شبکه‌ی داخلی، digest) و `worker` جای `scheduler` را
  گرفتند (فقط فایل؛ هیچ استقراری بدون تأیید انجام نمی‌شود). سلامت: `pnpm worker:health`. تصمیم‌ها: D22-1 و D22-2 در `docs/decisions.md`.
