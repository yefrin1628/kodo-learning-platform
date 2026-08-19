import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from './create-app';

// Vercel may reuse a "warm" function instance across nearby invocations,
// but a cold start gets a fresh module scope — caching the initialized app
// (not just a promise factory) across warm invocations avoids re-running
// Nest's full DI bootstrap on every single request, which is real overhead
// for a decorator/reflection-heavy framework like Nest. A module-level
// promise (not the resolved app) also means concurrent requests hitting a
// cold instance simultaneously all await the same single bootstrap instead
// of racing to create the app twice.
let appPromise: Promise<NestExpressApplication> | null = null;

function getApp(): Promise<NestExpressApplication> {
  if (!appPromise) {
    appPromise = createApp().then(async (app) => {
      await app.init();
      return app;
    });
  }
  return appPromise;
}

// Vercel's Node.js runtime calls this with the raw (req, res) — an Express
// app instance already matches that exact signature, so we hand off to it
// directly instead of using app.listen(), which serverless has no use for
// (Vercel's own edge network is the thing actually listening on a socket).
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();
  const expressInstance = app.getHttpAdapter().getInstance();
  expressInstance(req, res);
}
