import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const gatewayHttp = "http://127.0.0.1:3100";
const gatewayWs = "ws://127.0.0.1:3100";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Use IPv4 loopback explicitly to avoid intermittent ::1 proxy resolution failures.
      "/api": {
        target: gatewayHttp,
        configure(proxy) {
          proxy.on("error", (err, _req, res) => {
            const code = typeof (err as { code?: unknown }).code === "string"
              ? (err as { code: string }).code
              : "PROXY_ERROR";
            if (res && "writeHead" in res && !res.headersSent) {
              res.writeHead(503, { "Content-Type": "application/json" });
            }
            if (res && "end" in res) {
              res.end(JSON.stringify({ error: `Gateway unavailable (${code})` }));
            }
          });
        },
      },
      "/ws": {
        target: gatewayWs,
        ws: true,
        configure(proxy) {
          proxy.on("error", (_err) => {
            // WS reconnect logic in client handles temporary API unavailability.
          });
        },
      },
    },
  },
});
