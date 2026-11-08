// Use the installed Vite TypeScript loader; no second engine implementation.
import { createServer } from "../../frontend/node_modules/vite/dist/node/index.js";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../frontend/", import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  server: { middlewareMode: true },
  logLevel: "error",
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { generateDemo } = await server.ssrLoadModule(
    "../backend/tools/generate_open_demo.ts",
  );
  process.stdout.write(JSON.stringify(await generateDemo(process.argv[2])));
} finally {
  await server.close();
}
