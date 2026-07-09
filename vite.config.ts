import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// The local "crewclaw" launcher command shown on the website (DEV + the homepage market cards).
// It must embed the ACTUAL repo root of the machine serving the site — never a hardcoded absolute
// path (an earlier macOS path `/Volumes/Ventoy/...` shipped here and broke on every other machine).
// An explicit VITE_CREWCLAW_ROOT_COMMAND env var still wins; otherwise we derive it from this repo.
const crewclawRootCommand =
  process.env.VITE_CREWCLAW_ROOT_COMMAND ?? `pnpm --silent -C ${__dirname} run crewclaw`

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    inspectAttr(), react()],
  define: {
    "import.meta.env.VITE_CREWCLAW_ROOT_COMMAND": JSON.stringify(crewclawRootCommand),
  },
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
});
