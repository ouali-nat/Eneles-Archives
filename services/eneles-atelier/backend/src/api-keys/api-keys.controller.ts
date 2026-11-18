import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { CreateApiKeyDto, UpdateApiKeyDto } from './dto';

@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Get()
  async getUserApiKeys(
    @CurrentUser() userId: number,
    @Query() query: PaginationQueryDto,
  ) {
    return this.apiKeysService.getUserApiKeysPaginated(userId, {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      sort: query.sort ?? 'createdAt',
      order: query.order ?? 'desc',
    });
  }

  @Post()
  async createApiKey(
    @CurrentUser() userId: number,
    @Body() body: CreateApiKeyDto,
  ) {
    return this.apiKeysService.createApiKey(userId, body.name);
  }

  @Put(':id')
  async updateApiKeyName(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateApiKeyDto,
  ) {
    return this.apiKeysService.updateApiKeyName(userId, id, body.name);
  }

  @Delete(':id')
  async deleteApiKey(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.apiKeysService.deleteApiKey(userId, id);
  }
}
