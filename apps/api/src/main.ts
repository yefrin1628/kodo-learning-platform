import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

// Every real payload today is tiny (auth bodies, exercise answers — even
// RUN's `code` field is a few KB of student text at most); 100kb is
// generous headroom without leaving the default implicit/unbounded.
const MAX_BODY_SIZE = '100kb';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.use(json({ limit: MAX_BODY_SIZE }));
  app.use(urlencoded({ extended: true, limit: MAX_BODY_SIZE }));

  app.use(
    helmet({
      // JSON-only API, never serves HTML — CSP's defaults are harmless here
      // but Cross-Origin-Resource-Policy defaults to same-origin, which
      // would fight the whole point of enableCors() below (the frontend is
      // intentionally a different origin).
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3000',
    credentials: true,
  });

  // Unset by default (safe for local dev — no proxy in front of us here).
  // Set in production to however many hops sit between the real client and
  // this process (usually 1 for a single reverse proxy/load balancer), or
  // to a specific trusted address — never `true` (trusts every hop, lets
  // any client spoof X-Forwarded-For and defeat IP-based rate limiting).
  if (process.env.TRUST_PROXY) {
    const numericHops = Number(process.env.TRUST_PROXY);
    app.set('trust proxy', Number.isNaN(numericHops) ? process.env.TRUST_PROXY : numericHops);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Kodo API listening on http://localhost:${port}`);
}
bootstrap();
