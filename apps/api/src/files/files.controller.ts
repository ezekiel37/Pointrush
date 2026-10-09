import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AUTH_USER_ID, PublicRoute } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { RateLimit } from '../http/rate-limit.js';
import { FilesService } from './files.service.js';

function send(
  response: Response,
  file: { contentType: string; body: Buffer; cache: 'public' | 'private' },
  id: string,
) {
  response.setHeader('Content-Type', file.contentType);
  // File IDs never change their bytes, so public files cache for a long time.
  response.setHeader(
    'Cache-Control',
    file.cache === 'public'
      ? 'public, max-age=604800, immutable'
      : 'private, max-age=300',
  );
  // Never run as a page: no scripts, no sniffing, usable from the web app.
  response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  response.setHeader(
    'Content-Disposition',
    file.contentType === 'application/pdf'
      ? `attachment; filename="acticlaim-${id}.pdf"`
      : 'inline',
  );
  response.send(file.body);
}

@Controller()
export class FilesController {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}

  // The raw file is the body; Content-Type says what the browser thinks it
  // is, but the API checks the bytes itself.
  @Post('files')
  @RateLimit({ limit: 20, windowMs: 60000 })
  upload(
    @Req() request: AuthenticatedRequest & Request,
    @Query('purpose') purpose: unknown,
  ) {
    return this.files.upload(request[AUTH_USER_ID], purpose, request.body);
  }

  @PublicRoute()
  @Get('files/public/:id')
  async readPublic(@Param('id') id: string, @Res() response: Response) {
    send(response, await this.files.readPublic(id), id);
  }

  @Get('files/:id')
  async read(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    send(response, await this.files.read(request[AUTH_USER_ID], id), id);
  }

  @Get('accounts/me/avatar')
  avatar(@Req() request: AuthenticatedRequest) {
    return this.files.avatar(request[AUTH_USER_ID]);
  }

  @Post('accounts/me/avatar')
  setAvatar(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.files.setAvatar(request[AUTH_USER_ID], body);
  }
}
