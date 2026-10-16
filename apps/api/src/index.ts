import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { registerTiktokAuth } from "./auth/tiktok.ts";
import { registerYoutubeAuth } from "./auth/youtube.ts";
import { config } from "./config.ts";
import { registerJobRoutes } from "./jobs/routes.ts";
import { resumeStuckDownloads } from "./jobs/source-download.ts";
import { ensureDataDirs } from "./jobs/store.ts";
import { registerPublishRoutes } from "./publish/routes.ts";
import { getSystemStatus } from "./system.ts";

async function start(): Promise<void> {
  await ensureDataDirs();
  const app = Fastify({
    logger: true,
    bodyLimit: 1024 * 1024 * 32,
  });

  await app.register(cors, {
    origin: config.webOrigin,
    credentials: true,
  });
  await app.register(multipart, {
    limits: {
      fileSize: 4 * 1024 * 1024 * 1024,
    },
  });

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/status", async () => getSystemStatus());

  registerJobRoutes(app);
  registerPublishRoutes(app);
  registerYoutubeAuth(app);
  registerTiktokAuth(app);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  void resumeStuckDownloads();
}

start().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
