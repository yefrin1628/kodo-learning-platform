import 'reflect-metadata';
import { createApp } from './create-app';

// Persistent-server entrypoint — local dev (`nest start --watch`) and any
// future non-serverless host. Vercel uses serverless.ts instead, which
// shares createApp() but never binds a listening socket.
async function bootstrap() {
  const app = await createApp();
  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Kodo API listening on http://localhost:${port}`);
}
bootstrap();
