# راهنمای اجرای پروژه روی سیستم خودتان (لوکال)

این راهنما کل پروژه را روی یک کامپیوتر ویندوزی (یا لینوکس/مک) بالا می‌آورد: پایگاه‌داده، فضای ذخیره‌ی تصویر، صف، بک‌اند (API)، سایت و worker.
هیچ چیزی روی سرور یا سرویس بیرونی نمی‌رود. دستورها برای **PowerShell** نوشته شده‌اند؛ هر جا فرق دارد، معادل bash هم آمده است.

> خلاصه‌ی خیلی کوتاه (وقتی یک بار همه‌چیز را راه انداختید):
> `pnpm db:up` ← `pnpm db:deploy` ← `pnpm shared:build` ← در سه ترمینال: `pnpm api:dev`، `pnpm dev`، `pnpm worker` ← http://localhost:3000

---

## ۱. چه چیزهایی اجرا می‌شوند

| بخش | چیست | آدرس پیش‌فرض |
|---|---|---|
| **web** | سایت (Next.js): داشبورد فروشنده، پیش‌نمایش، ویترین فروشگاه‌ها | http://localhost:3000 |
| **api** | بک‌اند (NestJS): همه‌ی داده و منطق | http://localhost:4000/api |
| **worker** | کارهای پس‌زمینه: رویدادها (outbox)، پاک‌سازی دوره‌ای | بدون پورت |
| **postgres** | پایگاه‌داده (PostgreSQL 16، داخل Docker) | `localhost:5432` |
| **minio** | فضای ذخیره‌ی تصویر سازگار با S3 (داخل Docker) | http://localhost:9000 (کنسول: 9001) |
| **valkey** | صف کارها (سازگار با Redis، داخل Docker) | `localhost:6379` |

مرورگر فقط با web حرف می‌زند؛ web درخواست‌ها را به api می‌فرستد. api تنها بخشی است که به پایگاه‌داده و MinIO وصل می‌شود.

---

## ۲. پیش‌نیازها (یک بار)

1. **Git**
2. **Node.js نسخه‌ی ۲۲ یا بالاتر** (CI با ۲۲ اجرا می‌شود). بررسی: `node -v`
3. **pnpm نسخه‌ی 10.28.0.** ساده‌ترین راه:
   ```powershell
   corepack enable
   ```
   اگر corepack در دسترس نبود، هر جا در این راهنما `pnpm` آمده، به‌جایش بنویسید `npx -y pnpm@10.28.0`.
4. **Docker Desktop** (روشن باشد). **از ایران:** Docker Hub برای ایران خطای 403 می‌دهد؛ در Docker Desktop بروید
   Settings → Docker Engine و این را اضافه کنید، بعد Apply & Restart:
   ```json
   "registry-mirrors": ["https://docker.arvancloud.ir"]
   ```
   (جایگزین‌هایی که در 2026-11 کار می‌کردند: `docker.iranserver.com`، `registry.docker.ir`.)
5. **اختیاری:** ابزارهای کلاینت PostgreSQL **نسخه‌ی ۱۶** (`psql`، `pg_dump`) فقط برای آزمون‌های پشتیبان‌گیری لازم‌اند.

npm، GitHub و ghcr.io از ایران مستقیم در دسترس بودند.

---

## ۳. گرفتن کد و نصب وابستگی‌ها

```powershell
git clone https://github.com/Mamaad75/store-builder.git
```
```powershell
cd store-builder
```
```powershell
pnpm install
```

---

## ۴. فایل‌های تنظیمات (env)

دو فایل لازم است. **هیچ‌کدام commit نمی‌شوند** (در `.gitignore` هستند). از روی نمونه‌ها بسازید:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```
```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
```

مقدارهایی که برای اجرای لوکال باید درست باشند (همه **مقدار آزمایشی محلی‌اند**، نه رمز واقعی؛ با `docker-compose.yml` جور هستند):

**`apps/api/.env`**

| متغیر | مقدار لوکال | توضیح |
|---|---|---|
| `NODE_ENV` | `development` | حالت توسعه (پیش‌فرض‌های راحت فقط در این حالت فعال‌اند) |
| `DATABASE_URL` | `postgresql://storebuilder:storebuilder@localhost:5432/storebuilder` | اگر پورت را عوض کردید (بخش ۵)، اینجا هم عوض کنید |
| `AUTH_SECRET` | خالی بماند | در development یک کلید آزمایشی خودکار استفاده می‌شود. در production الزامی و حداقل ۳۲ کاراکتر است |
| `S3_ENDPOINT` | `http://localhost:9000` | MinIO محلی |
| `S3_BUCKET` | `store-builder-media` | همان باکتی که `pnpm db:up` می‌سازد |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | `minioadmin` / `minioadmin` | فقط برای MinIO محلی |
| `S3_FORCE_PATH_STYLE` | `true` | |
| `S3_PUBLIC_BASE_URL` | `http://localhost:9000/store-builder-media` | آدرس عمومی تصاویر |
| `REDIS_URL` | `redis://localhost:6379` | فقط worker استفاده می‌کند؛ در development اگر خالی باشد همین مقدار فرض می‌شود |
| `SECRETS_MASTER_KEYS` / `SECRETS_ACTIVE_KEY_ID` | اختیاری؛ مثلاً `dev1:<کلید>` و `dev1` | کلید اصلی رمزنگاری «کلیدهای محرمانه‌ی فروشگاه» (مثل کلید درگاه پرداخت). بدون آن این قابلیت خاموش است. ساخت کلید: `node -e "console.log(require(crypto).randomBytes(32).toString(base64))"`. این کلید را هرگز commit نکنید |

اگر متغیرهای `S3_*` را خالی بگذارید، API باز هم بالا می‌آید ولی آپلود تصویر کار نمی‌کند.

**`apps/web/.env.local`**

| متغیر | مقدار لوکال | توضیح |
|---|---|---|
| `APP_ROOT_DOMAIN` | `localhost:3000` | دامنه‌ی اصلی پلتفرم؛ فروشگاه‌ها روی `<نام>.localhost:3000` باز می‌شوند |
| `APP_PROTOCOL` | `http` | |
| `INTERNAL_API_URL` | `http://127.0.0.1:4000` | آدرسی که سایت با آن به API وصل می‌شود |
| `S3_PUBLIC_BASE_URL` | `http://localhost:9000/store-builder-media` | همان مقدار API؛ سایت فقط آدرس تصویر می‌سازد و رمز S3 ندارد |

---

### سوپرادمین و تنظیمات پلتفرم (فاز ۳.۱)
اولین سوپرادمین فقط از روی سرور یا سیستم خودتان ساخته می‌شود. یک حساب معمولی بسازید (ورود با نام کاربری است) و بعد این دستور را بزنید:
`pnpm --filter @store-builder/api platform:admin grant <username>`. فهرست مدیرها: `... platform:admin list`.
صفحه‌ها در `http://localhost:3000/platform` هستند. برای ذخیره‌ی کلیدهای API (پیامک، زرین‌پال و هوش مصنوعی)، API به `SECRETS_MASTER_KEYS` و
`SECRETS_ACTIVE_KEY_ID` نیاز دارد (راهنمای ساختشان در `docs/security.md` آمده است). بدون آن‌ها تنظیمات ذخیره می‌شود، ولی کلیدها نه.

### متریک و ردیابی خطا (اختیاری، فاز ۲.۶)
اگر `METRICS_PORT=9464` را به env در API یا worker اضافه کنید، متریک‌ها روی `http://127.0.0.1:9464/metrics` در دسترس است.
`ERROR_TRACKING_DSN` را خالی بگذارید، مگر اینکه یک GlitchTip داشته باشید. جزئیات در `docs/observability.md` است.

## ۵. بالا آوردن پایگاه‌داده، MinIO و Valkey

```powershell
pnpm db:up
```
این دستور `docker compose up -d` است: PostgreSQL، MinIO (به‌همراه ساخت باکت) و Valkey. داده‌ها در volumeهای Docker می‌مانند و با خاموش شدن از بین نمی‌روند.

**اگر پورتی از قبل گرفته شده** (مثلاً PostgreSQL یا Redis خود ویندوز روی 5432 یا 6379):
```powershell
$env:POSTGRES_HOST_PORT="15432"; $env:VALKEY_HOST_PORT="16379"; pnpm db:up
```
و بعد در `apps/api/.env` پورت را در `DATABASE_URL` به `15432` و در `REDIS_URL` به `16379` تغییر دهید.
روی ویندوز بعضی بازه‌های پورت رزرو شده‌اند؛ برای دیدنشان: `netsh interface ipv4 show excludedportrange protocol=tcp`.

بررسی سلامت:
```powershell
docker compose ps
```
همه باید `healthy` باشند.

---

## ۶. آماده‌سازی پایگاه‌داده (یک بار، و بعد از هر pull که migration جدید دارد)

```powershell
pnpm db:generate
```
```powershell
pnpm db:deploy
```
```powershell
pnpm db:seed
```

* `db:generate` کلاینت Prisma را می‌سازد.
* `db:deploy` همه‌ی migrationها را اعمال می‌کند (جدول‌ها، از جمله `OutboxEvent`).
* `db:seed` قالب‌ها را می‌سازد (۸ تم صنفی + ۴ تم قدیمی). تکرارش بی‌خطر است و چیزی را بازنویسی نمی‌کند.

---

## ۷. ساختن پکیج مشترک

```powershell
pnpm shared:build
```
این را یک بار، و بعد از هر تغییر در `packages/shared` بزنید. (یا در یک ترمینال جدا `pnpm shared:dev` تا خودکار ساخته شود.)

---

## ۸. اجرا (سه ترمینال)

**ترمینال ۱: بک‌اند**
```powershell
pnpm api:dev
```
منتظر خط `api.listening` با پورت 4000 بمانید. سلامت: http://localhost:4000/api/health

**ترمینال ۲: سایت**
```powershell
pnpm dev
```
سپس http://localhost:3000 را باز کنید.

**ترمینال ۳ (اختیاری): worker**
```powershell
pnpm worker
```
بدون worker هم همه‌چیز کار می‌کند؛ فقط رویدادها (مثل «فروشگاه منتشر شد») در جدول outbox می‌مانند تا worker روشن شود، و پاک‌سازی دوره‌ای اجرا نمی‌شود.
روی ویندوز، کارهای دوره‌ای worker (پاک‌سازی رسانه و پایگاه‌داده) به‌صورت زیرفرایند `tsx` اجرا می‌شوند که روی ویندوز ممکن نیست؛ در لاگ `job.failed` می‌بینید.
این محدودیت فقط محلی است (در Docker/لینوکس کار می‌کند). همین کارها را دستی هم می‌توانید بزنید: `pnpm media:cleanup` و `pnpm db:cleanup`.

---

## ۹. استفاده (یک سناریوی کامل)

1. http://localhost:3000 ← **ثبت‌نام** با نام کاربری و رمز (حداقل ۸ کاراکتر). ایمیل لازم نیست.
2. **ساخت فروشگاه:** نام فروشگاه، **نوع کسب‌وکار** (۸ دسته) و **تم** (هر دسته تم خودش را پیشنهاد می‌کند؛ هر تمی را می‌شود انتخاب کرد).
3. در پنل فروشگاه: **دسته‌بندی‌ها** ← **محصولات** (نام، قیمت، موجودی، تصویر، مشخصات) ← محصول را **فعال** کنید.
   تصویرها در MinIO ذخیره می‌شوند (کنسول: http://localhost:9001 با `minioadmin`/`minioadmin`).
4. **لوگو و رنگ** در تنظیمات فروشگاه؛ **صفحه‌ها** را در ویرایشگر صفحه تغییر دهید.
5. **پیش‌نمایش:** دکمه‌ی پیش‌نمایش (`/preview/<شناسه>`)؛ فقط خود شما می‌بینید و هیچ چیزی منتشر نمی‌شود.
6. **انتشار:** در صفحه‌ی انتشار یک زیردامنه (مثلاً `myshop`) بگیرید و منتشر کنید. فروشگاه روی
   **http://myshop.localhost:3000** باز می‌شود (Chrome و Edge نام‌های `*.localhost` را خودشان به همین کامپیوتر می‌فرستند).
7. اگر worker روشن است، در لاگش `store.published.received` را می‌بینید.

ابزار دیدن پایگاه‌داده (فقط محلی):
```powershell
pnpm db:studio
```
(Prisma Studio روی http://localhost:5555؛ جزئیات و گزینه‌ی DBeaver در `docs/local-database.md`.)

---

## ۱۰. آزمون‌ها

| دستور | چه چیزی | پیش‌نیاز |
|---|---|---|
| `pnpm lint` | lint همه‌ی پکیج‌ها | — |
| `pnpm typecheck` | بررسی نوع‌ها | — |
| `pnpm test` | آزمون‌های unit (shared، api، web) | — |
| `pnpm test:db` | آزمون‌های پایگاه‌داده‌ی API | PostgreSQL روشن؛ یک پایگاه‌داده‌ی جدا (`storebuilder_api_test`) می‌سازد و پاک می‌کند، به داده‌ی شما دست نمی‌زند |
| `pnpm test:storage` | آزمون‌های S3 | MinIO روشن |
| `pnpm test:queue` | outbox ← صف ← مصرف‌کننده روی Valkey واقعی | PostgreSQL و Valkey روشن |
| `pnpm check` | typecheck + lint + unit + DB | PostgreSQL روشن |
| `pnpm test:e2e` | آزمون‌های مرورگر (Playwright) | **فقط لینوکس/WSL** (روی ویندوز کپی bundle خراب می‌شود)؛ CI همیشه اجرا می‌کند |

اگر پورت‌ها را عوض کرده‌اید، قبل از آزمون‌ها آدرس را بدهید:
```powershell
$env:DATABASE_URL="postgresql://storebuilder:storebuilder@localhost:15432/storebuilder"; $env:REDIS_URL="redis://localhost:16379"; pnpm test:db
```

نکته‌ها:
* آزمون‌های پشتیبان‌گیری (`backup.db.test.ts`) به `pg_dump`/`psql` **نسخه‌ی ۱۶** روی PATH نیاز دارند؛ با نسخه‌ی ۱۸ دو آزمون رد می‌شوند (شناخته‌شده).
* روی ویندوز سه آزمون unit که «فرایند واقعی» اجرا می‌کنند رد می‌شوند (`db-studio-guard` ×۲، `mailer` ×۱)؛ شناخته‌شده و فقط مخصوص ویندوز.
* آزمون زمان‌سنجی «انتشار ۵۰۰ محصول در ۱۰ ثانیه» روی سیستم کند (مثلاً Docker تازه روشن‌شده) ممکن است رد شود؛ در CI معتبر است.
* مرورگر Playwright از CDN خودش برای ایران دانلود نمی‌شود؛ برای E2E روی مرورگر نصب‌شده: `$env:E2E_BROWSER_CHANNEL="chrome"; pnpm test:e2e`.

---

## ۱۱. عیب‌یابی

| مشکل | علت و راه‌حل |
|---|---|
| `docker compose` خطای 403 یا pull نمی‌شود | mirror داخلی را اضافه کنید (بخش ۲) |
| `failed to connect to the docker API` | Docker Desktop روشن نیست؛ اجرایش کنید و چند ثانیه صبر کنید |
| `Can't reach database server` | `docker compose ps`؛ اگر پورت را عوض کرده‌اید، `DATABASE_URL` را هم عوض کنید |
| صفحه‌ی ورود: «سرویس موقتاً در دسترس نیست» | API روشن نیست یا `INTERNAL_API_URL` اشتباه است؛ http://localhost:4000/api/health را باز کنید |
| «تعداد تلاش‌ها بیش از حد مجاز است» | محدودیت ورود: ۱۰ تلاش برای هر نام کاربری در ۱۵ دقیقه (در PostgreSQL ذخیره می‌شود و با ری‌استارت پاک نمی‌شود). ۱۵ دقیقه صبر کنید |
| `pnpm api:dev` می‌گوید فایل `.env` پیدا نشد | `apps/api/.env` را بسازید (بخش ۴) |
| آپلود تصویر کار نمی‌کند | MinIO روشن نیست یا متغیرهای `S3_*` در `apps/api/.env` خالی‌اند |
| `next dev` روی ویندوز مدام صفحه را دوباره بارگذاری می‌کند (حلقه‌ی HMR) | از اجرای production استفاده کنید (پایین همین جدول) |
| `next dev` فایل‌های `AGENTS.md` یا `next-env.d.ts` را عوض می‌کند | آن تغییرها را commit نکنید: `git checkout -- apps/web/next-env.d.ts` |
| پورت 3000 بعد از بستن ترمینال هنوز اشغال است | فرایند node باقی مانده؛ در PowerShell: `Get-NetTCPConnection -LocalPort 3000 -State Listen` و بعد `taskkill /PID <شماره> /T /F` |
| فونت تیترها اول Vazirmatn است و بعد عوض می‌شود | عادی است (`font-display: swap`): فونت هر تم فقط وقتی لازم است دانلود می‌شود |

### اجرای سایت در حالت production (وقتی `next dev` مشکل دارد)

در حالت production، مسیر `/api` را در سرور واقعی Caddy به API می‌فرستد؛ در لوکال باید هنگام **build** به Next بگویید این کار را خودش بکند:

```powershell
$env:API_DEV_PROXY_URL="http://127.0.0.1:4000"; pnpm build
```
```powershell
Copy-Item -Recurse -Force apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
```
```powershell
cd apps/web/.next/standalone/apps/web; $env:NODE_ENV="production"; $env:PORT="3000"; $env:HOSTNAME="127.0.0.1"; $env:APP_ROOT_DOMAIN="localhost:3000"; $env:APP_PROTOCOL="http"; $env:INTERNAL_API_URL="http://127.0.0.1:4000"; $env:API_DEV_PROXY_URL="http://127.0.0.1:4000"; $env:TRUST_PROXY_HEADERS="true"; $env:TRUSTED_PROXY_HOPS="1"; $env:S3_PUBLIC_BASE_URL="http://localhost:9000/store-builder-media"; node server.js
```
حالت production سخت‌گیر است: بدون `TRUST_PROXY_HEADERS` و `S3_PUBLIC_BASE_URL` اجرا نمی‌شود و خطای `startup.refused` می‌دهد (عمدی است).

---

## ۱۲. خاموش کردن

* سایت، API و worker: در هر ترمینال `Ctrl+C`.
* سرویس‌های Docker:
  ```powershell
  pnpm db:down
  ```
  داده‌ها باقی می‌مانند. **هشدار:** `docker compose down -v` همه‌ی داده‌ی محلی (پایگاه‌داده، تصاویر، صف) را **برای همیشه** پاک می‌کند.

---

## ۱۳. بعد از هر `git pull`

```powershell
pnpm install
```
```powershell
pnpm db:generate; pnpm db:deploy; pnpm db:seed
```
```powershell
pnpm shared:build
```
سپس API، سایت و worker را دوباره اجرا کنید. تغییرات هر نسخه در `CHANGELOG.md` آمده است.
