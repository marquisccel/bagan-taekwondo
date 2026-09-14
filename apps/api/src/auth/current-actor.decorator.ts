import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { Actor } from './actor';

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<{ actor?: Actor }>();
  if (!req.actor) throw new Error('CurrentActor used without ActorGuard');
  return req.actor;
});
