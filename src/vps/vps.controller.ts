import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { VpsService } from './vps.service';
import { CreateVpsDto } from './dto/create-vps.dto';
import { UpdateVpsDto } from './dto/update-vps.dto';
import { BulkImportVpsDto } from './dto/bulk-import-vps.dto';

/**
 * RBAC (CLAUDE.md #6):
 *  - Viewer     : boleh list & detail (read-only dashboard).
 *  - Operator   : sama (tidak boleh provisioning/hapus VPS — PRD §4).
 *  - Superadmin : create/update/delete/re-provision/bulk-import.
 */
@Controller('vps')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VpsController {
  constructor(private readonly vps: VpsService) {}

  @Get()
  findAll(@Query('env') env?: string, @Query('group') group?: string) {
    return this.vps.findAll({ env, group });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vps.findOne(id);
  }

  @Post()
  @Roles(Role.SUPERADMIN)
  create(@Body() dto: CreateVpsDto, @CurrentUser() user: AuthUser) {
    return this.vps.create(dto, user.id);
  }

  /** Bulk import beberapa VPS sekaligus (Fase 6). */
  @Post('bulk-import')
  @Roles(Role.SUPERADMIN)
  bulkImport(@Body() dto: BulkImportVpsDto, @CurrentUser() user: AuthUser) {
    return this.vps.bulkImport(dto, user.id);
  }

  @Patch(':id')
  @Roles(Role.SUPERADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateVpsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.vps.update(id, dto, user.id);
  }

  @Delete(':id')
  @Roles(Role.SUPERADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.vps.remove(id, user.id);
  }

  @Post(':id/reprovision')
  @Roles(Role.SUPERADMIN)
  reprovision(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.vps.reprovision(id, user.id);
  }
}
