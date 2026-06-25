import http from "node:http";

export function startMockModel(scenario) {
  const multiTurn = Array.isArray(scenario) && Array.isArray(scenario[0]);
  const turns = multiTurn ? scenario : null;
  const chunks = Array.isArray(scenario) && !multiTurn ? scenario : [];
  let requestIndex = 0;

  const chunksForRequest = () => {
    if (!multiTurn) return chunks;
    if (!turns.length) return [];
    const index = Math.min(requestIndex, turns.length - 1);
    requestIndex += 1;
    return turns[index];
  };

  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    req.resume();
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "close",
    });
    res.flushHeaders?.();

    for (const chunk of chunksForRequest()) {
      if (chunk?.done) break;
      const delta = { content: chunk?.content || "" };
      if (chunk?.tool_calls) delta.tool_calls = chunk.tool_calls;
      res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  });

  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.close();
      reject(error);
    };

    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise((res, rej) => {
          server.close((error) => (error ? rej(error) : res()));
        }),
      });
    });
  });
}
