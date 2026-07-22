import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.LONG_ROT_MCP_URL || "http://127.0.0.1:3000";
  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 4173,
      proxy: {
        "/mcp": {
          target,
          changeOrigin: true
        }
      },
      watch: {
        ignored: ["**/src-tauri/target/**"]
      }
    }
  };
});
