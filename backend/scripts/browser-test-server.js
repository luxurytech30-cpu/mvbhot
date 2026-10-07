// Isolated browser-test service. Never reads or writes the user's saved accounts.
import { createAccountStore } from "../src/accounts/account-store.js";
import { createAssistantServer } from "../src/server/create-server.js";
const createStore = () =>
  createAccountStore({
    file: null,
    ...(process.env.NOVA_TEST_NOW ? { clock: () => new Date(process.env.NOVA_TEST_NOW) } : {}),
  });
let current = createStore();
const store = new Proxy(
  {},
  {
    get:
      (_target, key) =>
      (...args) =>
        current[key](...args),
  },
);
const server = createAssistantServer({ store });
const handler = server.listeners("request")[0];
server.removeAllListeners("request");
server.on("request", (request, response) => {
  if (request.url === "/api/test/reset" && request.method === "POST") {
    current = createStore();
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"ok":true}');
  } else void handler(request, response);
});
const port = Number(process.env.NOVA_TEST_PORT || 5099);
server.listen(port, "127.0.0.1", () => console.log(`Isolated Nova browser-test API on ${port}`));
