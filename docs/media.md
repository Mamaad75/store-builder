# Media and images (phase 7)

## Overview

```
browser --multipart--> Server Action (requireUser) --> uploadMedia(ownerId, storeId, bytes)
                                                        1. store ownership (SQL)            -> NotFound for foreign/missing
                                                        2. rate limit per user+store         -> MediaRateLimitError
                                                        3. processImage (sharp)              -> MediaValidationError
                                                        4. [tx, store row locked] quota check + INSERT Media(PENDING)
                                                        5. MediaStorage.put(key)             (outside any transaction)
                                                        6. [tx] PENDING -> READY
        then attachProductImage / setStoreLogo (a second owner-scoped transaction)

storefront data (StorefrontData) holds only {key,width,height}; the public URL is built by the host at render time
(`mediaPublicUrl`: <S3_PUBLIC_BASE_URL>/<key>).
```

Product images and the store logo use the **same** pipeline (`uploadMedia`); an architecture test enforces that there is one
`processImage` call and one `storage.put` call site.

## The image pipeline (`src/modules/media/process.ts`)

* Limits (server side): 5 MB upload, 25 megapixels decoded input, 2048 x 2048 output, 100 images and 100 MB processed bytes per store.
* The format is detected from the **bytes** (JPEG, PNG, WebP). The file name and the browser MIME type are never used. SVG, GIF, TIFF, HEIC, PDF, ZIP, HTML... are rejected.
* Container structure is checked: JPEG must end with `FFD9`, PNG must end exactly at `IEND`, WebP's RIFF size must match the file. Bytes appended after the image (polyglots) are rejected. Animated PNG (`acTL`), animated WebP (`ANIM`/`ANMF`/VP8X flag) and multi-frame inputs are rejected.
* Decompression bombs: the header dimensions are checked against 25 MP **before** decoding, and sharp's `limitInputPixels` is a second guard.
* The image is oriented (EXIF), downscaled to fit 2048 x 2048 (never enlarged) and **re-encoded as WebP**. Re-encoding drops EXIF/GPS/ICC and anything embedded; transparency is preserved.
* **Format conversion:** every accepted image is stored as `image/webp` with the `.webp` extension. The stored MIME type, the key extension and the width/height/size recorded in the database always come from the encoder's output (not from the client), and a database CHECK constraint enforces `mimeType = 'image/webp'` and a `.webp` key.
* Library error text is never shown to users (fixed Persian messages).

## Object keys and public URLs

* Keys are generated only by `newMediaKey`: `stores/<storeId>/<128 random bits as hex>.webp` (CSPRNG). They cannot be guessed from a media id, product or time, and nothing user-controlled is part of a key. Every storage operation re-validates the key shape, and a CHECK constraint binds the key to its owning store.
* `S3_PUBLIC_BASE_URL` is the single configuration point; `mediaPublicUrl(key)` is the single place a URL is built. The database and storefront snapshots store **relative keys only**, so the bucket host/CDN can change without touching data.
* Reads are public and unauthenticated; writes use server-only credentials. The bucket policy must allow anonymous `s3:GetObject` on objects only (no `ListBucket`, no write). `docker-compose.yml` and the CI/E2E bucket setup apply exactly this policy.
* **Anyone who has an image URL can read that image.** Do not use this mechanism for private or confidential files.
* **Drafts:** a public URL does not publish anything. Draft/archived products are never part of storefront data, so their images are never referenced by rendered pages; the public storefront (phase 10) renders only the immutable snapshot, which lists only the images of products that were published.

## Consistency strategy (storage and database are not atomic)

A database transaction cannot include an S3 call, so correctness rests on **ordering, a state column and an idempotent cleanup**.

`Media.status`: `PENDING` (reserved, quota counted) -> `READY` (usable) -> `DELETING` (tombstone, never referenced again).

Upload: the reservation row is committed **before** the object is written, under the store row lock (the same lock every catalog write uses), so:

* quotas are concurrency-safe (count and bytes are checked and the row inserted in one locked transaction; PENDING and DELETING rows count);
* every object that exists in the bucket has a committed row.

| Failure | What happens |
|---|---|
| Validation / quota / rate limit | Nothing is written. |
| `put` fails (even if the write may have partially succeeded) | The object is deleted (idempotent) and the reservation removed. If the delete also fails, the **PENDING row is kept** as the handle for cleanup. |
| Database fails after `put` (PENDING -> READY) | The object is deleted and the reservation removed; if that fails, the row stays PENDING for cleanup. |
| Process dies at any point | Left as PENDING row (+ maybe an object): cleanup. |

Deletion (`releaseMedia`), only for **unreferenced** media:

1. [tx, store locked] verify READY and unreferenced, mark `DELETING`. A non-READY row can never get a new reference (attach re-checks under the same lock).
2. delete the object (idempotent: deleting a missing key succeeds).
3. [tx] delete the row.

If step 2 or 3 fails the row stays `DELETING`; the user-visible operation (detaching) has already succeeded and cleanup finishes the job.

### After a committed change: the release never fails it (D10-12)

Replacing or removing a product image, replacing or removing the logo, deleting a product and editing a page section each (1) commit the change in one transaction and only then (2) release the image that is no longer referenced. The change is the truth; the release is an after-effect. Every one of these call sites uses `releaseMediaBestEffort`, which **never throws**: a failure (store busy, database error) is reported to the owner as nothing, and written as **one structured log line** (`{"event":"media.release_failed","storeId","mediaId","reason":"store_busy"|"error","recovery":"pnpm media:cleanup"}`), and the image is left for the cleanup job. Nothing is retried in the request and nothing is queued: the database rows are the queue.

| Failure of the follow-up release | State left behind | Recovery |
|---|---|---|
| "mark DELETING" fails (store busy, database error) or the process dies after the commit | image `READY`, unreferenced, counts against the quota, object still served | cleanup step 4 (below) |
| object delete fails | row `DELETING` (not attachable) | cleanup step 2 |
| row delete fails after the object is gone | row `DELETING` | cleanup step 2 |

**References that block deletion** (`isMediaReferenced`): a product image, the store logo (also protected by composite foreign keys and `NO ACTION`), any page section JSON that mentions the media id, and any `StoreVersion` snapshot that mentions the object key (the published site and its rollbacks). Removing an image from a product that is already published therefore keeps the object alive until no version references it. New reference kinds must be added to `isMediaReferenced`. The database additionally refuses to delete a referenced `Media` row.

## Cleanup (`runMediaCleanup`, `pnpm media:cleanup`)

Idempotent and safe at any time, also while uploads run. Not scheduled by this repository (no infrastructure in this phase). **Scheduling it is a mandatory phase 14 release requirement** (periodic scheduler, non-zero exit detection, logs and alerts, verified recovery of failed items, tested in staging before production; `docs/roadmap.md` "Mandatory for phase 14", D10-13).

1. **Expired PENDING rows** (older than the grace period): claim the row with a conditional `PENDING -> DELETING` update, delete the object, delete the row. If the upload completed meanwhile the claim fails and nothing is touched.
2. **DELETING rows** older than the grace period: finish the physical delete.
3. **Orphan objects:** list the bucket under `stores/`; an object older than the grace period that has **no row at all** (for example because its store was deleted, which cascades to rows but cannot reach the object store) is deleted. Keys that do not match the media key format are ignored.

How active uploads are protected: an upload's object is always preceded by its committed row (so it is never "row-less"); READY rows and objects are never touched; every step ignores anything younger than the grace period (1 hour, far longer than an upload); a failure on one item is counted and does not stop the run. Running it twice changes nothing the second time.

4. **Unreferenced READY media** (older than the grace period): the old image of a change whose release did not run or failed. A cheap SQL pre-filter selects candidates (no product image, not the logo); `reclaimMedia` then makes the authoritative, reference-aware decision **under the store lock**, with the same rules as `releaseMedia` (page sections, archived sections and published snapshots all keep their media). It marks the row `DELETING` first (an attach re-checks `READY` under the same lock, so a reclaimed image can never be attached), then deletes the object and the row. It uses a lock-only transaction, so a background reclaim **never bumps a store's draft revision**. The scan is bounded per run (`maxScan`, default 5,000 candidates; `scanTruncated` in the report says when the limit was hit; later runs continue).

The report (`pnpm media:cleanup` prints it as JSON) includes `unreferencedReadyScanned`, `unreferencedReadyReclaimed`, `scanTruncated` and `failures`. **The script exits with code 2 when any item failed**, so a scheduler or monitor notices; failed items are retried by the next run.

Store deletion removes rows by cascade; the objects are removed by step 3 after the grace period.

**Known limits.** Nothing in this repository schedules the cleanup (no infrastructure in this phase; scheduling is a mandatory phase 14 release gate, D10-13): until `pnpm media:cleanup` runs, a replaced image whose release failed keeps its public URL and its quota slot. The reclaim step is a periodic scan (cost proportional to unreferenced READY rows, snapshot checks are text scans of the store's versions); at the quota of 100 images per store this is small, and the per-run bound protects the job.

## Security limitations (known and accepted)

* Image URLs are public to anyone who has them (documented above).
* The grace period means an orphaned object can live up to about an hour (or until cleanup is run).
* Images that fail to be removed because storage is down stay in the quota (as `DELETING`/`PENDING`) until cleanup runs.
* Content moderation, virus scanning and CDN/cache invalidation are out of scope. Cache headers are `public, max-age=31536000, immutable` because keys are never reused.
* Rate limiting reuses the shared PostgreSQL limiter: 20 uploads per 10 minutes per user and store.

## Tests

* `process.test.ts` (unit): formats, limits, polyglots, animation, bombs, metadata stripping, orientation, transparency.
* `media.db.test.ts` (PostgreSQL + in-memory storage with failure injection): upload, quotas (including concurrent), every failure scenario above, reference-aware deletion, cross-tenant forgery, cleanup (idempotence, grace period, active-upload protection).
* `*.storage.test.ts` (PostgreSQL + a real S3-compatible server): put, anonymous public read, list, delete, idempotent delete, read-only public access (policy enforcing servers), real transport failure, pipeline end to end. In CI this runs against MinIO.
* `e2e/media.spec.ts`: upload through the UI, image loaded from the bucket in the browser, preview, replace/remove (objects really deleted), invalid files, forged ids, logo.
* Test storage is isolated: `src/test/storage-env.ts` only accepts a loopback endpoint and a bucket ending in `-test`/`-e2e`, and never reads the production `S3_*` variables.

## CI note: MinIO image

Run 5 showed that `minio/minio` is no longer pullable from Docker Hub. CI and `docker-compose.yml` use `bitnamilegacy/minio` (a real MinIO server), pinned by tag and digest in `scripts/ci-start-minio.sh`. The image is unmaintained, so it is only used for throw-away test/dev containers. A maintained replacement (for example an image built from MinIO's own releases) is a phase 13 decision.

**Root cause of the intermittent storage-job failures (CI runs 8-11, reproduced locally).** The image's default entrypoint (bitnami setup) starts a temporary MinIO, configures `mc`, stops it about 5 s later and only then starts the real server. `/minio/health/ready` answers 200 on the temporary instance, so a readiness check passed and the tests then hit the restart window: connections were dropped without a response (`ECONNRESET`, undici `other side closed`), on anonymous requests and on privileged SDK calls alike. Locally, starting the tests 1 s after "ready" reproduced the exact CI signature (3 failures); 0 s, 2.8 s and later passed, which is why CI passed some runs. `scripts/ci-start-minio.sh` now runs the MinIO binary directly (no setup phase, no restart) and additionally requires the server to stay ready for 6 s before the tests start. No test assertion changed. `docker-compose.yml` (development only) still uses the default entrypoint and therefore has the same ~5 s window after `up`.
