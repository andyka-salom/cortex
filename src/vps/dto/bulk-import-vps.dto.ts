import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, ValidateNested } from 'class-validator';
import { CreateVpsDto } from './create-vps.dto';

export class BulkImportVpsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVpsDto)
  @IsNotEmpty()
  items: CreateVpsDto[];
}
