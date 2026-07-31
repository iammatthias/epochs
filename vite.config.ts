import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// The Cloudflare plugin runs the Worker in workerd during `vite dev`, so the
// dev server is the same runtime that serves production — not a Node shim that
// happens to expose fetch.
export default defineConfig({
  plugins: [cloudflare()],
});
