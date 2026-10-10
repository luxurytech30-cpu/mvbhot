import { demoAccounts } from "./demo-accounts.js";
import { plans } from "./subscription-plans.js";
import { screenFromPath } from "../navigation/navigation-routes.js";
import { publicTVData } from "../information/catalog-data.js";

export const allowedOrigins = new Set(
  (
    process.env.APP_ORIGINS ||
    "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174"
  ).split(","),
);
export function originAllowed(request) {
  return !request.headers.origin || allowedOrigins.has(request.headers.origin);
}
function reply(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}
async function body(request) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 16384) throw Object.assign(new Error("Request too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}
export function createAccountApi(store, { onLogout = () => {} } = {}) {
  const attempts = new Map();
  return async (request, response) => {
    if (!originAllowed(request)) return reply(response, 403, { error: "Origin is not allowed" });
    if (request.headers.origin) {
      response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.writeHead(204);
      response.end();
      return;
    }
    const path = new URL(request.url, "http://local").pathname;
    try {
      if (request.method === "GET" && path === "/api/health")
        return reply(response, 200, { ok: true });
      if (request.method === "GET" && path === "/api/demo")
        return reply(response, 200, {
          accounts: demoAccounts,
          plans,
          catalog: publicTVData(),
          demo: true,
        });
      if (request.method === "POST" && path === "/api/auth/login") {
        if (!request.headers["content-type"]?.startsWith("application/json"))
          return reply(response, 415, { error: "JSON is required" });
        const address = request.socket.remoteAddress;
        for (const [key, entry] of attempts) if (entry.until < Date.now()) attempts.delete(key);
        const entry = attempts.get(address) || {
          count: 0,
          until: Date.now() + 60000,
        };
        if (++entry.count > 20)
          return reply(response, 429, {
            error: "Too many login attempts. Try again in a minute.",
          });
        attempts.set(address, entry);
        const credentials = await body(request);
        const result = await store.login(credentials.email, credentials.password);
        const previous = store.authenticate(request);
        if (previous) {
          store.logout(previous.token);
          onLogout(previous.token);
        }
        response.setHeader(
          "Set-Cookie",
          `nova_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
        );
        return reply(response, 200, { user: result.user });
      }
      // Retired text/audio APIs remain unavailable.
      if (
        ![
          "/api/account",
          "/api/context",
          "/api/auth/session",
          "/api/auth/logout",
          "/api/playback",
        ].includes(path)
      )
        return reply(response, 404, { error: "Unknown endpoint" });
      const session = store.authenticate(request);
      if (!session) return reply(response, 401, { error: "Sign in to continue" });
      if (request.method === "POST" && path === "/api/playback") {
        if (!request.headers["content-type"]?.startsWith("application/json"))
          return reply(response, 415, { error: "JSON is required" });
        const target = await body(request);
        const access = store.authorizePlayback(session.userId, target);
        return reply(response, 200, { access, user: store.getUser(session.userId) });
      }
      if (request.method === "GET" && path === "/api/auth/session")
        return reply(response, 200, { user: store.getUser(session.userId) });
      if (request.method === "GET" && path === "/api/context")
        return reply(response, 200, {
          context: store.getContext(session.userId),
        });
      if (request.method === "PATCH" && path === "/api/context") {
        if (!request.headers["content-type"]?.startsWith("application/json"))
          return reply(response, 415, { error: "JSON is required" });
        const { path: tvPath, uiState } = await body(request);
        let screen;
        try {
          screen = screenFromPath(tvPath);
        } catch {
          return reply(response, 400, { error: "Unknown TV screen" });
        }
        if (uiState !== undefined && (
          !uiState || typeof uiState !== "object" || Array.isArray(uiState) ||
          typeof uiState.menuOpen !== "boolean" ||
          ![null, "notifications"].includes(uiState.dialog)
        )) return reply(response, 400, { error: "Invalid TV state" });
        store.setContext(session.userId, {
          path: tvPath,
          imageName: `${screen}.png`,
          uiState: uiState || { menuOpen: false, dialog: null },
        });
        return reply(response, 200, { ok: true });
      }
      if (request.method === "POST" && path === "/api/auth/logout") {
        store.logout(session.token);
        onLogout(session.token);
        response.setHeader(
          "Set-Cookie",
          "nova_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        );
        return reply(response, 200, { ok: true });
      }
      if (request.method === "PATCH" && path === "/api/account") {
        if (!request.headers["content-type"]?.startsWith("application/json"))
          return reply(response, 415, { error: "JSON is required" });
        return reply(response, 200, {
          user: store.update(session.userId, await body(request)),
        });
      }
      return reply(response, 405, { error: "Method not allowed" });
    } catch (error) {
      if (error.status) reply(response, error.status, { error: error.message });
      else {
        console.error("Account request failed", error.code || error.name);
        reply(response, 500, {
          error: "Could not save account data. Please try again.",
        });
      }
    }
  };
}
