/** Public API of the blog module (docs/architecture/modules.md). Free of NestJS; app.module.ts imports blog.module.ts directly. */
export { BlogService } from "./application/blog.service.js";
export { createBlogService } from "./infrastructure/compose.js";
