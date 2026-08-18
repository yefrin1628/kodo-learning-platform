import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

// Catches every exception (HttpException AND unexpected errors) so every
// request that ends in an error produces exactly one structured log line —
// today's default Nest logging only reliably covers HttpExceptions thrown
// through the normal pipeline, and raw stack traces printed via
// console.error elsewhere are unstructured and hard to grep/aggregate in
// production. Never logs the request body or Authorization header (auth
// payloads/passwords), and never returns a stack trace to the client.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    // Errors thrown by middleware BEFORE Nest's routing layer (e.g. the
    // express.json() body-parser rejecting an oversized payload) are plain
    // Error objects with a numeric `status`/`statusCode` property, not
    // HttpExceptions — without this branch they'd all collapse to a generic
    // 500, discarding the real (and often client-actionable) status code.
    const rawStatus = this.extractRawStatus(exception);
    const status = isHttpException
      ? exception.getStatus()
      : (rawStatus ?? HttpStatus.INTERNAL_SERVER_ERROR);

    const exceptionResponse = isHttpException ? exception.getResponse() : null;
    // Only surface the raw error's own message for genuine 4xx cases (e.g.
    // "request entity too large") — a 5xx from an unexpected error keeps the
    // generic message so we never leak internals (DB errors, file paths) to
    // the client; the real detail still goes to the server log below.
    const message = isHttpException
      ? this.extractMessage(exceptionResponse)
      : rawStatus && rawStatus < 500 && exception instanceof Error
        ? exception.message
        : 'Internal server error';

    const logLine = {
      timestamp: new Date().toISOString(),
      level: status >= 500 ? 'error' : 'warn',
      method: request.method,
      path: request.originalUrl ?? request.url,
      statusCode: status,
      message,
      // Only present when auth middleware has already attached a user.
      userId: (request as Request & { user?: { userId?: string } }).user?.userId,
    };

    if (status >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(JSON.stringify(logLine), stack);
    } else {
      this.logger.warn(JSON.stringify(logLine));
    }

    response.status(status).json({
      statusCode: status,
      message,
    });
  }

  private extractRawStatus(exception: unknown): number | null {
    if (
      exception &&
      typeof exception === 'object' &&
      ('status' in exception || 'statusCode' in exception)
    ) {
      const value =
        (exception as { status?: unknown; statusCode?: unknown }).status ??
        (exception as { status?: unknown; statusCode?: unknown }).statusCode;
      if (typeof value === 'number' && value >= 400 && value < 600) {
        return value;
      }
    }
    return null;
  }

  private extractMessage(exceptionResponse: unknown): string | string[] {
    if (typeof exceptionResponse === 'string') return exceptionResponse;
    if (
      exceptionResponse &&
      typeof exceptionResponse === 'object' &&
      'message' in exceptionResponse
    ) {
      return (exceptionResponse as { message: string | string[] }).message;
    }
    return 'Error';
  }
}
