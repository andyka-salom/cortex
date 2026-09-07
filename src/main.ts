import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Validasi & strip field asing di semua DTO.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // UI (login, dashboard VPS, terminal) — static assets, disajikan langsung dari
  // ./public (bukan lewat dist, jadi tidak perlu rebuild untuk edit HTML/CSS/JS).
  app.useStaticAssets(join(process.cwd(), 'public'));

  app.setGlobalPrefix('api');
  app.enableCors();

  const port = Number(process.env.PORT || 3000);
  await app.listen(port);
  Logger.log(`Cortex control plane jalan di http://localhost:${port}/api`, 'Bootstrap');
}
bootstrap();
