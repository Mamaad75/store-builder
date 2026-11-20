# قرارداد ماژول‌های بک‌اند (فاز ۲.۱ — ADR 0002 §۲.۱ و §۲.۲)

این سند قاعده‌ی ساخت هر ماژول در `apps/api/src/modules/` است. گاردهای معماری
(`apps/api/src/__tests__/module-boundaries.architecture.test.ts`) همین قواعد را در `pnpm test` اجبار می‌کنند؛ اگر قاعده‌ای این‌جا
عوض شود، گارد هم باید در همان commit عوض شود.

ماژول مرجع: **`modules/categories`**. ماژول جدید را از روی آن بسازید.

## ۱. چیدمان

```
modules/<context>/
  domain/            قواعد کسب‌وکار؛ TypeScript خالص
  application/       use caseها (سرویس کاربردی) + portها (interface) + خطاهای قرارداد port
  infrastructure/    پیاده‌سازی portها با Prisma / سرویس بیرونی + تابع ساخت (composition)
  interface/         Controller (HTTP)
  <context>.module.ts   ماژول NestJS: controllerها و providerها را سیم‌کشی می‌کند
  <context>.api.ts      رابط عمومی: تنها فایلی که ماژول‌های دیگر حق import آن را دارند
```

در ریشه‌ی ماژول جز این دو فایل (و تست‌ها) فایل دیگری نیست.

## ۲. جهت وابستگی (گارد اجبار می‌کند)

| لایه | مجاز است import کند | ممنوع |
|---|---|---|
| `domain` | `domain` همین ماژول، `@store-builder/shared/*`، `zod` | Nest، Prisma، Express، `lib/db`، `database/`، هر لایه‌ی دیگر، هر ماژول دیگر |
| `application` | `domain` و `application` همین ماژول، `@store-builder/shared/*`، `zod` | Nest، Prisma، Express، `infrastructure`، `interface`، `lib/db`، `database/`، ماژول دیگر |
| `infrastructure` | همه‌چیز جز `interface` و فایل‌های ریشه‌ی ماژول؛ ماژول دیگر فقط از راه `<other>.api.ts` | — |
| `interface` | `application` و `domain` همین ماژول، `auth/`، `http/`، `@nestjs/*` | `infrastructure`، Prisma، `lib/db`، `database/` |

* **بین ماژول‌ها:** هر فایل بیرون از ماژول X فقط `modules/X/X.api.ts` را import می‌کند. تنها استثنا `app.module.ts` است که
  `X.module.ts` را برای ثبت ماژول import می‌کند.
* **ماژول‌های قدیمی** (`catalog`، `media`، `pages`، `products`، `publishing`، `storefront`، `stores`) در فهرست ثابت `LEGACY` گارد
  هستند و هنوز ساختار تخت دارند. ماژول لایه‌ای از آن‌ها هم فقط از راه `<legacy>.api.ts` استفاده می‌کند (مثلاً `stores/stores.api.ts`).
  هر ماژول قدیمی وقتی به‌طور جدی دست بخورد به این قالب درمی‌آید و از فهرست حذف می‌شود؛ **به این فهرست چیزی اضافه نمی‌شود.**

## ۳. هر لایه چه دارد

### domain
* قاعده‌ها به شکل تابع خالص یا value object؛ ورودی و خروجی داده‌ی ساده.
* خطاها: کلاس‌های خطای مشترک `@store-builder/shared/modules/stores/errors` (`ValidationError`، `NotFoundError`، …) تا `AllExceptionsFilter`
  همان پاسخ HTTP قبلی را بسازد.
* نمونه: `assertBelowLimit`، `assertUniqueName` (نرمال‌سازی حروف فارسی/عربی و ارقام)، `newSlug` (slug فقط یک بار ساخته می‌شود).

### application
* **سرویس کاربردی** یک کلاس ساده (بدون decorator Nest) که portها را در constructor می‌گیرد. هر متد یک use case است:
  ورودی خام (`unknown`) را با اسکیمای Zod مشترک اعتبارسنجی می‌کند، قاعده‌های domain را صدا می‌زند و کار را داخل **Unit of Work** انجام می‌دهد.
  وقتی یک use case بزرگ شد (مثلاً ثبت سفارش)، کلاس جدای خودش را می‌گیرد.
* **portها** (`application/ports.ts`):
  * `…Reader`: خواندن خارج از تراکنش، همیشه با `ownerId` (تفکیک مستأجر در خود SQL انجام می‌شود، نه در کد).
  * `…UnitOfWork.run(ownerId, storeId, work)`: یک تراکنش که مالکیت را در SQL چک می‌کند، ردیف فروشگاه را قفل و `draftRevision` را
    یک واحد بالا می‌برد، و اگر `work` خطا بدهد همه‌چیز rollback می‌شود. پیاده‌سازی فعلی آن `withStoreMutation` است (قفل ۵ ثانیه‌ای،
    `DraftBusyError`، ترتیب قفل Store → category → product).
  * **خطاهای قرارداد port** (`DuplicateKeyError`، `StillReferencedError`): آداپتور خطای درایور (P2002/P2003) را به این‌ها ترجمه می‌کند
    تا use case هرگز Prisma را نبیند.

### infrastructure
* `prisma-<x>.repository.ts`: تنها فایل ماژول که `lib/db` را import می‌کند. هر تابع نوشتن، `ctx: MutationContext` را به‌عنوان اولین پارامتر
  می‌گیرد (بدون آن کامپایل نمی‌شود) و فیلتر `storeId` + `ownerId` در خود کوئری است.
* `<x>.adapters.ts`: کلاس‌هایی که portها را با آن توابع پیاده می‌کنند، به‌علاوه‌ی `create<X>Service()` (composition: تنها جایی که
  پیاده‌سازی‌ها به سرویس داده می‌شوند).

### interface
* Controller نازک: کاربر را از `@CurrentUser()` (هرگز از بدنه‌ی درخواست) می‌گیرد، سرویس را با `@Inject(<X>Service)` دریافت و صدا می‌زند.
  Guard نشست (`SessionGuard`) روی کل controller.

### `<context>.module.ts` و `<context>.api.ts`
* ماژول Nest سرویس را با `useFactory: create<X>Service` فراهم و export می‌کند؛ `app.module.ts` آن را در `imports` ثبت می‌کند.
  (`AppModule` سراسری است و `AuthService`، `SessionGuard` و `CONFIG` را export می‌کند تا Guard در ماژول‌های فرزند resolve شود.)
* فایل api فقط چیزی را export می‌کند که ماژول دیگر واقعاً لازم دارد؛ مثلاً `findCategoryInTx` برای محصولات، که باید **داخل تراکنش
  خود محصول** وجود دسته را بررسی کنند.

## ۴. تست

| لایه | نوع تست | مثال |
|---|---|---|
| domain | unit، بدون هیچ fake | `domain/category.test.ts` |
| application | unit با portهای درون‌حافظه‌ای (Unit of Work درون‌حافظه‌ای که rollback را شبیه‌سازی می‌کند) | `application/category.service.test.ts` |
| infrastructure + کل مسیر | تست پایگاه‌داده (`*.db.test.ts`) روی PostgreSQL واقعی: تفکیک مستأجر، هم‌روندی، قیدها | `categories.db.test.ts` |
| HTTP | تست برنامه‌ی Nest با fake یا E2E | `__tests__/app.test.ts`، `apps/e2e` |

گارد، وجود حداقل یک فایل تست در `domain/` و `application/` هر ماژول لایه‌ای را هم چک می‌کند.

## ۵. چک‌لیست ماژول جدید
1. پوشه‌ها و دو فایل ریشه را مثل `categories` بسازید؛ نام ماژول را به فهرست `LEGACY` اضافه **نکنید**.
2. قاعده‌ها در domain + تست unit.
3. portها و سرویس در application + تست با fake.
4. repository و adapterها در infrastructure + تست db برای تفکیک مستأجر.
5. controller در interface؛ ماژول را در `app.module.ts` import کنید.
6. `pnpm --filter @store-builder/api typecheck && pnpm --filter @store-builder/api lint && pnpm --filter @store-builder/api test`.
