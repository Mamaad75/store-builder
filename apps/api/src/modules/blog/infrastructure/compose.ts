import { BlogService } from "../application/blog.service.js";
import { PrismaBlogRepository } from "./prisma-blog.repository.js";

export const createBlogService = (): BlogService => new BlogService(new PrismaBlogRepository());
