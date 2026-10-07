import { WebSocketServer } from "ws";
import { createLiveConversation } from "./live-conversation.js";
import { originAllowed } from "../accounts/account-routes.js";

export function attachLiveWebSocketServer(server, options) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 32768 });
  const connections = new Map();
  const heartbeat = setInterval(() => {
    for (const client of connections.keys()) {
      if (client.alive === false) {
        client.terminate();
        continue;
      }
      client.alive = false;
      client.ping();
    }
  }, 30000);
  heartbeat.unref?.();
  server.on("close", () => clearInterval(heartbeat));
  server.on("upgrade", (request, socket, head) => {
    const session = options.store.authenticate(request);
    if (request.url !== "/api/live" || !session || !originAllowed(request)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    if ([...connections.values()].filter((item) => item.userId === session.userId).length >= 2) {
      socket.end("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => {
      connections.set(client, session);
      client.alive = true;
      client.on("pong", () => {
        client.alive = true;
      });
      const expiry = setTimeout(
        () => client.close(1008, "Session expired"),
        session.expires - Date.now(),
      );
      expiry.unref?.();
      client.on("close", () => {
        clearTimeout(expiry);
        connections.delete(client);
      });
      createLiveConversation(client, {
        ...options,
        getUser: () => {
          if (!options.store.authenticate(request)) throw new Error("Session expired");
          return options.store.getUser(session.userId);
        },
        getContext: () => options.store.getContext(session.userId),
        subscribeContext: (listener) => options.store.subscribeContext(session.userId, listener),
      });
    });
  });
  sockets.closeSession = (token) => {
    for (const [client, session] of connections)
      if (session.token === token) client.close(1008, "Signed out");
  };
  return sockets;
}
