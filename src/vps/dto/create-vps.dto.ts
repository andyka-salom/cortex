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

export class CreateVpsDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  name: string;

  @IsIP()
  ipAddress: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  sshPort?: number;

  @IsString()
  @MinLength(1)
  sshUser: string;

  /**
   * SSH private key PLAINTEXT (paste/upload dari user).
   * Langsung dienkripsi di service, TIDAK PERNAH disimpan/di-log plaintext.
   */
  @IsString()
  @MinLength(1)
  privateKey: string;

  @IsEnum(Environment)
  env: Environment;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  group: string;
}
