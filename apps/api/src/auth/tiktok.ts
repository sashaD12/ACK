import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config, paths } from "../config.ts";
import {
  deleteFileIfExists,
  readJsonFile,
  writeJsonFile,
  type TiktokTokens,
} from "./tokens.ts";

const TIKTOK_SCOPES = ["user.info.basic", "video.upload", "video.publish"];

interface TiktokTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export async function getTiktokTokens(): Promise<TiktokTokens | null> {
  const tokens = await readJsonFile<TiktokTokens>(paths.tiktokTokenFile);
  if (!tokens) {
    return null;
  }
  if (tokens.expires_at > Date.now() + 60_000) {
    return tokens;
  }
  if (tokens.refresh_expires_at <= Date.now()) {
    return null;
  }
  return refreshTiktokTokens(tokens.refresh_token);
}

async function refreshTiktokTokens(refreshToken: string): Promise<TiktokTokens | null> {
  const body = new URLSearchParams({
    client_key: config.tiktokClientKey,
    client_secret: config.tiktokClientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = (await response.json()) as TiktokTokenResponse;
  if (!data.access_token || !data.refresh_token) {
    return null;
  }
  const tokens = toTiktokTokens(data);
  await writeJsonFile(paths.tiktokTokenFile, tokens);
  return tokens;
}

function toTiktokTokens(data: TiktokTokenResponse): TiktokTokens {
  const now = Date.now();
  return {
    access_token: data.access_token ?? "",
    refresh_token: data.refresh_token ?? "",
    expires_at: now + (data.expires_in ?? 86400) * 1000,
    refresh_expires_at: now + (data.refresh_expires_in ?? 31536000) * 1000,
    open_id: data.open_id ?? "",
    scope: data.scope ?? TIKTOK_SCOPES.join(","),
  };
}

export async function isTiktokConnected(): Promise<boolean> {
  const tokens = await getTiktokTokens();
  return Boolean(tokens?.access_token);
}

export function registerTiktokAuth(app: FastifyInstance): void {
  app.get("/api/auth/tiktok", async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!config.tiktokClientKey || !config.tiktokClientSecret) {
      return reply.code(400).send({
        error: "TikTok OAuth is not configured. Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET.",
      });
    }
    const csrf = crypto.randomUUID();
    const params = new URLSearchParams({
      client_key: config.tiktokClientKey,
      redirect_uri: config.tiktokRedirectUri,
      response_type: "code",
      scope: TIKTOK_SCOPES.join(","),
      state: csrf,
    });
    return reply.redirect(
      `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`
    );
  });

  app.get(
    "/api/auth/tiktok/callback",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { code?: string; error?: string };
      if (query.error || !query.code) {
        return reply.redirect(`${config.webOrigin}/?tiktok=error`);
      }
      const body = new URLSearchParams({
        client_key: config.tiktokClientKey,
        client_secret: config.tiktokClientSecret,
        code: query.code,
        grant_type: "authorization_code",
        redirect_uri: config.tiktokRedirectUri,
      });
      const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      const data = (await response.json()) as TiktokTokenResponse;
      if (!data.access_token) {
        return reply.redirect(`${config.webOrigin}/?tiktok=error`);
      }
      await writeJsonFile(paths.tiktokTokenFile, toTiktokTokens(data));
      return reply.redirect(`${config.webOrigin}/?tiktok=connected`);
    }
  );

  app.get("/api/auth/tiktok/status", async () => {
    return {
      connected: await isTiktokConnected(),
      configured: Boolean(config.tiktokClientKey && config.tiktokClientSecret),
    };
  });

  app.post("/api/auth/tiktok/disconnect", async () => {
    await deleteFileIfExists(paths.tiktokTokenFile);
    return { ok: true };
  });
}
