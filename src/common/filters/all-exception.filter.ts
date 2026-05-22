import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { BusinessException } from '../exceptions/business.exception';
import { TRACE_ID_KEY } from '../middleware/trace-id.middleware';

@Catch()
export class AllExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { [TRACE_ID_KEY]?: string }>();
    const res = ctx.getResponse<Response>();
    const traceId = req[TRACE_ID_KEY] ?? '';

    let httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
    let bizCode = 500;
    let msg = 'internal server error';

    if (exception instanceof BusinessException) {
      httpStatus = exception.getStatus();
      bizCode = exception.bizCode;
      msg = exception.bizMsg;
    } else if (exception instanceof HttpException) {
      httpStatus = exception.getStatus();
      bizCode = httpStatus;
      const r = exception.getResponse();
      if (typeof r === 'string') {
        msg = r;
      } else if (r && typeof r === 'object') {
        const obj = r as Record<string, unknown>;
        const m = obj.message ?? obj.msg ?? exception.message;
        msg = Array.isArray(m) ? m.join('; ') : String(m);
      } else {
        msg = exception.message;
      }
    } else if (exception instanceof Error) {
      msg = exception.message;
      this.logger.error(`${req.method} ${req.url} -> ${msg}`, exception.stack);
    } else {
      this.logger.error(`${req.method} ${req.url} -> unknown exception`, String(exception));
    }

    res.status(httpStatus).json({
      code: bizCode,
      msg,
      data: null,
      traceId,
    });
  }
}
