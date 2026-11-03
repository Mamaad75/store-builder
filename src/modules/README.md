# Modules

Each domain module (auth, stores, products, pages, media, publishing, templates, domains) will own its
validation (zod), service and data-access code. Route handlers and server actions stay thin and call
into modules. Every data access for tenant data must go through the store-ownership check (added in step 4).
