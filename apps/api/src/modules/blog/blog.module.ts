import { Module } from "@nestjs/common";
import { BlogService } from "./application/blog.service.js";
import { createBlogService } from "./infrastructure/compose.js";
import { StoreBlogController } from "./interface/blog.controllers.js";

/** The store blog (draft posts and posts going live with the next publish). */
@Module({ controllers: [StoreBlogController], providers: [{ provide: BlogService, useFactory: createBlogService }] })
export class BlogModule {}
