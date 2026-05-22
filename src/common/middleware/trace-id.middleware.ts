import { randomUUID } from 'crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

export const TRACE_ID_HEADER = 'x-trace-id';
export const TRACE_ID_KEY = 'traceId';

@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  use(
    req: Request & { [TRACE_ID_KEY]?: string },
    res: Response,
    next: NextFunction,
  ) {
    const incoming = req.headers[TRACE_ID_HEADER];
    const traceId = (typeof incoming === 'string' && incoming) || randomUUID();
    req[TRACE_ID_KEY] = traceId;
    res.setHeader(TRACE_ID_HEADER, traceId);
    next();
  }
}
