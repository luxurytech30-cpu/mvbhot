import { createServer } from "node:http";
import { attachLiveWebSocketServer } from "../live/live-websocket-server.js";
import { createAccountStore } from "../accounts/account-store.js";
import { createAccountApi } from "../accounts/account-routes.js";

export function createAssistantServer(options = {}) {
  const store = options.store || createAccountStore();
  let live;
  const server = createServer(
    createAccountApi(store, { onLogout: (token) => live?.closeSession(token) }),
  );
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  live = attachLiveWebSocketServer(server, { ...options, store });
  return server;
}
