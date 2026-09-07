import {
  IsEnum,
  IsInt,
  IsIP,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Environment } from '@prisma/client';

/** Update sebagian field VPS. privateKey opsional — hanya re-encrypt bila dikirim. */
export class UpdateVpsDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsIP()
  ipAddress?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  sshPort?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  sshUser?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  privateKey?: string;

  @IsOptional()
  @IsEnum(Environment)
  env?: Environment;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  group?: string;
}
