import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class AlertThresholdDto {
  @IsOptional()
  @IsString()
  vpsId?: string; // null/kosong = global

  @IsEnum(['cpu', 'ram', 'disk'])
  metricType: 'cpu' | 'ram' | 'disk';

  @IsNumber()
  @Min(1)
  @Max(100)
  threshold: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMin?: number;
}
