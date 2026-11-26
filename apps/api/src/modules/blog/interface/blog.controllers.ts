import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../../auth/session.guard.js";
import { Audit, RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../../access/access.api.js";
import { BlogService } from "../application/blog.service.js";

/**
 * The store's blog posts (owner and manager: content.manage). A post marked "ready to publish" goes live with the next store publish, like
 * the rest of the site. Plain text only.
 */
@Controller("stores/:storeId/blog")
@UseGuards(SessionGuard, StoreAccessGuard)
export class StoreBlogController {
  constructor(@Inject(BlogService) private readonly blog: BlogService) {}

  @Get()
  @RequirePermission("content.manage")
  list(@StoreAccess() a: StoreAccessContext) {
    return this.blog.list(a);
  }

  @Get(":postId")
  @RequirePermission("content.manage")
  get(@StoreAccess() a: StoreAccessContext, @Param("postId") id: string) {
    return this.blog.get(a, id);
  }

  @Post()
  @RequirePermission("content.manage")
  @Audit("blog.created")
  create(@StoreAccess() a: StoreAccessContext, @Body() body: unknown) {
    return this.blog.create(a, body);
  }

  @Put(":postId")
  @RequirePermission("content.manage")
  @Audit("blog.updated", { type: "post", param: "postId" })
  update(@StoreAccess() a: StoreAccessContext, @Param("postId") id: string, @Body() body: unknown) {
    return this.blog.update(a, id, body);
  }

  @Post(":postId/delete")
  @HttpCode(204)
  @RequirePermission("content.manage")
  @Audit("blog.deleted", { type: "post", param: "postId" })
  async remove(@StoreAccess() a: StoreAccessContext, @Param("postId") id: string): Promise<void> {
    await this.blog.remove(a, id);
  }
}
