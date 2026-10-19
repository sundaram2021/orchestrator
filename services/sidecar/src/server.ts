import http from "node:http";
import { errMessage } from "./util/coerce.js";
import { WebSocketServer, WebSocket } from "ws";
import {
  ClientRequestSchema,
  type DomainEvent,
  type ServerReply,
  type ServerPush,
} from "@orchestrator/contracts";
import type { Orchestrator } from "./Orchestrator.js";
import type { Broadcaster } from "./Broadcaster.js";
import type { RequestHandlers } from "./rpc/RequestHandlers.js";
import { createMcpHandler } from "./mcp/OrchestratorMcpServer.js";
import { logger } from "./util/logger.js";

const log = logger("server");

export interface ServerHandle {
  port: number;
  close: () => Promise<void>;
}

export function startServer(
  orchestrator: Orchestrator,
  handlers: RequestHandlers,
  bus: Broadcaster,
  preferredPort: number,
): Promise<ServerHandle> {
  const mcpHandler = createMcpHandler(orchestrator);
  const httpServer = http.createServer((req, res) => {
    const path = req.url?.split("?")[0] ?? "";
    if (path === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, status: orchestrator.snapshot().status }));
      return;
    }
    if (path === "/mcp") {
      mcpHandler(req, res);
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server: httpServer });

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && preferredPort !== 0) {
      log.warn(`port ${preferredPort} in use, falling back to a free port`);
      httpServer.listen(0, "127.0.0.1");
    }
  });

  wss.on("error", (err: Error) => {
    log.warn(`websocket server error: ${err.message}`);
  });

  bus.on((event: DomainEvent) => {
    const message: ServerPush = { push: "event", event };
    const payload = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  });

  wss.on("connection", (socket) => {
    log.info("client connected");

    const reply = (msg: ServerReply): void => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
    };

    socket.on("message", async (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const request = ClientRequestSchema.safeParse(parsed);
      if (!request.success) return;
      const { id, method, params } = request.data;

      try {
        const result = await handlers.handle(method, params);
        reply({ id, ok: true, result });
      } catch (err) {
        reply({ id, ok: false, error: errMessage(err) });
      }
    });

    socket.on("close", () => log.info("client disconnected"));
  });

  return new Promise((resolve) => {
    httpServer.listen(preferredPort, "127.0.0.1", () => {
      const address = httpServer.address();
      const port = typeof address === "object" && address ? address.port : preferredPort;
      log.info(`listening on ws://127.0.0.1:${port}`);
      resolve({
        port,
        close: () =>
          new Promise<void>((res) => {
            for (const client of wss.clients) client.terminate();
            wss.close(() => httpServer.close(() => res()));
          }),
      });
    });
  });
}
