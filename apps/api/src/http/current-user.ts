import { type ExecutionContext, createParamDecorator } from "@nestjs/common";
import type { AuthedRequest } from "../auth/session.guard.js";

/** The signed-in user (set by SessionGuard). Controllers hand `user.id` to the services as the owner; it never comes from the request. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().sessionUser);
