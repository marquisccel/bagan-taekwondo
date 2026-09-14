import { DomainError } from '@bagantkd/shared';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

import { API_ERROR_STATUS } from './api-error';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Catches everything so no response ever carries a stack trace or an internal message (Phase 4
 * §15/§19). `HttpException`s (including `ApiError`) pass their own body and status through
 * unchanged; a `DomainError` from a repository (an integration bug, not a business rejection —
 * those are returned as data and mapped by the controller) maps by its `code`; anything else is an
 * opaque 500.
 */
@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('DomainErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<JsonResponse>();

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof DomainError) {
      this.logger.warn(`${exception.code}: ${exception.message}`);
      res
        .status(API_ERROR_STATUS[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ code: exception.code, message: exception.code });
      return;
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ code: 'INTERNAL_ERROR', message: 'internal error' });
  }
}
