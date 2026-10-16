import { google } from "googleapis";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config, paths } from "../config.ts";
import {
  deleteFileIfExists,
  readJsonFile,
  writeJsonFile,
  type YoutubeTokens,
} from "./tokens.ts";

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];

export function createYoutubeOAuthClient() {
  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri
  );
}

export async function getYoutubeAuth() {
  const tokens = await readJsonFile<YoutubeTokens>(paths.youtubeTokenFile);
  if (!tokens) {
    return null;
  }
  const client = createYoutubeOAuthClient();
  client.setCredentials(tokens);
  client.on("tokens", (fresh) => {
    const next: YoutubeTokens = {
      access_token: fresh.access_token ?? tokens.access_token,
      refresh_token: fresh.refresh_token ?? tokens.refresh_token,
      expiry_date: fresh.expiry_date ?? tokens.expiry_date,
      token_type: fresh.token_type ?? tokens.token_type,
      scope: fresh.scope ?? tokens.scope,
    };
    void writeJsonFile(paths.youtubeTokenFile, next);
  });
  return client;
}

export async function isYoutubeConnected(): Promise<boolean> {
  const tokens = await readJsonFile<YoutubeTokens>(paths.youtubeTokenFile);
  return Boolean(tokens?.refresh_token || tokens?.access_token);
}

export function registerYoutubeAuth(app: FastifyInstance): void {
  app.get("/api/auth/youtube", async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!config.googleClientId || !config.googleClientSecret) {
      return reply.code(400).send({
        error: "YouTube OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      });
    }
    const client = createYoutubeOAuthClient();
    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES,
    });
    return reply.redirect(url);
  });

  app.get(
    "/api/auth/youtube/callback",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { code?: string; error?: string };
      if (query.error || !query.code) {
        return reply.redirect(`${config.webOrigin}/?youtube=error`);
      }
      const client = createYoutubeOAuthClient();
      const { tokens } = await client.getToken(query.code);
      const stored: YoutubeTokens = {
        access_token: tokens.access_token ?? "",
        refresh_token: tokens.refresh_token ?? "",
        expiry_date: tokens.expiry_date ?? Date.now(),
        token_type: tokens.token_type ?? "Bearer",
        scope: tokens.scope ?? SCOPES.join(" "),
      };
      const previous = await readJsonFile<YoutubeTokens>(paths.youtubeTokenFile);
      if (!stored.refresh_token && previous?.refresh_token) {
        stored.refresh_token = previous.refresh_token;
      }
      await writeJsonFile(paths.youtubeTokenFile, stored);
      return reply.redirect(`${config.webOrigin}/?youtube=connected`);
    }
  );

  app.get("/api/auth/youtube/status", async () => {
    return {
      connected: await isYoutubeConnected(),
      configured: Boolean(config.googleClientId && config.googleClientSecret),
    };
  });

  app.post("/api/auth/youtube/disconnect", async () => {
    await deleteFileIfExists(paths.youtubeTokenFile);
    return { ok: true };
  });
}
