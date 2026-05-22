import { HttpException, HttpStatus } from '@nestjs/common';

export class BusinessException extends HttpException {
  constructor(
    public readonly bizCode: number,
    public readonly bizMsg: string,
    httpStatus: HttpStatus = HttpStatus.OK,
  ) {
    super({ code: bizCode, msg: bizMsg }, httpStatus);
  }
}
