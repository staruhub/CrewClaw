import http from "node:http";

// OpenAI-compatible mock model server for runtime tests.
//
//   startMockModel(chunks)                  — every request streams the same chunk list (SSE)
//   startMockModel([turn1, turn2, ...])     — request N streams turn N (last turn repeats)
//   startMockModel(scenario, { dreamResponse }) — requests whose body carries the
//       crewclaw.dream/v1 contract get a NON-STREAM JSON completion with dreamResponse
//       (object is stringified) and do not consume a scenario turn.
//
// Non-stream requests (body.stream !== true) always get a plain JSON completion — the runtime's
// callModel({stream:false}) parses choices[0].message.content, not SSE.
export function startMockModel(scenario, { dreamResponse } = {}) {
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

  const joinedContent = requestChunks =>
    requestChunks
      .filter(chunk => !chunk?.done)
      .map(chunk => chunk?.content || "")
      .join("");

  const writeJsonCompletion = (res, content, toolCalls) => {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content,
              ...(toolCalls ? { tool_calls: toolCalls } : {}),
            },
          },
        ],
        usage: { prompt_tokens: 64, completion_tokens: 128, total_tokens: 192 },
      })
    );
  };

  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    let rawBody = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      rawBody += chunk;
    });
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(rawBody || "{}");
      } catch {
        body = {};
      }

      if (dreamResponse !== undefined && rawBody.includes("crewclaw.dream/v1")) {
        const content =
          typeof dreamResponse === "string"
            ? dreamResponse
            : JSON.stringify(dreamResponse);
        writeJsonCompletion(res, content);
        return;
      }

      const requestChunks = chunksForRequest();

      if (body.stream !== true) {
        writeJsonCompletion(res, joinedContent(requestChunks));
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "close",
      });
      res.flushHeaders?.();

      for (const chunk of requestChunks) {
        if (chunk?.done) break;
        const delta = { content: chunk?.content || "" };
        if (chunk?.tool_calls) delta.tool_calls = chunk.tool_calls;
        res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
      }

      res.write("data: [DONE]\n\n");
      res.end();
    });
  });

  return new Promise((resolve, reject) => {
    const onError = error => {
      server.close();
      reject(error);
    };

    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        close: () =>
          new Promise((res, rej) => {
            server.close(error => (error ? rej(error) : res()));
          }),
      });
    });
  });
}
