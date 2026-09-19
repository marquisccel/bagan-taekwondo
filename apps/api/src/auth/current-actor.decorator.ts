import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { Actor } from './actor';

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<{ actor?: Actor }>();
  if (!req.actor) throw new Error('CurrentActor used without ActorGuard');
  return req.actor;
});

/** The caller's user id on `@ActorScope()` routes (no tournament-level role is resolved there). */
export const CurrentActorId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ actorId?: string }>();
  if (!req.actorId) throw new Error('CurrentActorId used without ActorGuard on an @ActorScope route');
  return req.actorId;
});
