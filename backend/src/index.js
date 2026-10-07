import { pathToFileURL } from "node:url";
import { createAssistantServer } from "./server/create-server.js";

const PORT = process.env.PORT || 5000;
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createAssistantServer().listen(PORT, () =>
    console.log(`Live voice server running on port ${PORT}`),
  );
}
