import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { GithubService } from './github.service';

class LinkGithubDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  repo: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9._/-]*$/, { message: 'That is not a branch name' })
  branch?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  token: string;
}

class PullGithubDto {
  @IsOptional()
  @IsBoolean()
  preferGithub?: boolean;
}

class PushGithubDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

/** GitHub sync for a project. Linking, pushing, and pulling are the owner's. */
@Controller('projects/:uid/github')
@UseGuards(ThrottlerGuard)
export class GithubController {
  constructor(private readonly github: GithubService) {}

  @Get()
  status(@CurrentUser() userId: number, @Param('uid') uid: string) {
    return this.github.status(uid, userId);
  }

  @Post()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  link(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Body() dto: LinkGithubDto,
  ) {
    return this.github.link(uid, userId, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  unlink(@CurrentUser() userId: number, @Param('uid') uid: string) {
    return this.github.unlink(uid, userId);
  }

  @Post('push')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  push(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Body() dto: PushGithubDto,
  ) {
    return this.github.push(uid, userId, dto.message);
  }

  @Post('pull')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  pull(
    @CurrentUser() userId: number,
    @Param('uid') uid: string,
    @Body() dto: PullGithubDto,
  ) {
    return this.github.pull(uid, userId, dto.preferGithub === true);
  }
}
