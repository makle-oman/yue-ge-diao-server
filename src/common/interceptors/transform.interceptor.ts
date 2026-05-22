import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { TRACE_ID_KEY } from '../middleware/trace-id.middleware';

export interface ApiEnvelope<T> {
  code: number;
  msg: string;
  data: T;
  traceId: string;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiEnvelope<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiEnvelope<T>> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { [TRACE_ID_KEY]?: string }>();
    return next.handle().pipe(
      map((data) => ({
        code: 200,
        msg: 'ok',
        data: (data ?? null) as T,
        traceId: req[TRACE_ID_KEY] ?? '',
      })),
    );
  }
}
