import assert from "node:assert/strict";

import { callModel, probeModelAccess } from "../run.mjs";

// v0.20 G2：probeModelAccess 是 crew doctor 模型预检的核心。锁住它对上游返回码的分类，
// 尤其是"key 有效但模型无权限(403)"这条——正是 crew chat 里 HTTP 403 的真实根因。

const realFetch = globalThis.fetch;
const stubFetch = handler => {
  globalThis.fetch = async (url, init) => handler(String(url), init);
};
const restore = () => {
  globalThis.fetch = realFetch;
};

// 全程保证 CREW_MOCK 不污染非 mock 用例（除专门的 mock 用例外）。
const savedMock = process.env.CREW_MOCK;
delete process.env.CREW_MOCK;

try {
  // 缺 key → missing_key，且不发网络请求。
  {
    let called = false;
    stubFetch(() => {
      called = true;
      return { ok: true, status: 200, text: async () => "" };
    });
    const r = await probeModelAccess({
      model: "x/y",
      apiKey: "",
      baseUrl: "https://z/api/v1",
    });
    restore();
    assert.equal(r.ok, false);
    assert.equal(r.code, "missing_key");
    assert.equal(called, false, "缺 key 时不应发请求");
  }

  // CREW_MOCK=1 → 直接短路为 mock，不碰网络。
  {
    process.env.CREW_MOCK = "1";
    let called = false;
    stubFetch(() => {
      called = true;
      return { ok: true, status: 200, text: async () => "" };
    });
    const r = await probeModelAccess({
      model: "x/y",
      apiKey: "k",
      baseUrl: "https://z/api/v1",
    });
    restore();
    delete process.env.CREW_MOCK;
    assert.equal(r.ok, true);
    assert.equal(r.code, "mock");
    assert.equal(called, false, "mock 模式不应发请求");
  }

  // 200 → ok，且诊断结果不回显 endpoint（它可能含嵌入式凭据）。
  {
    stubFetch(url => {
      assert.ok(url.endsWith("/chat/completions"), `unexpected url ${url}`);
      return { ok: true, status: 200, text: async () => "{}" };
    });
    const r = await probeModelAccess({
      model: "x/y",
      apiKey: "k",
      baseUrl: "https://z/api/v1/",
    });
    restore();
    assert.equal(r.ok, true);
    assert.equal(r.code, "ok");
    assert.equal("baseUrl" in r, false);
  }

  // 403 on chat 但 /models 200 → forbidden_key_valid（真实世界的 ZENMUX 情形）。
  {
    stubFetch(url => {
      if (url.endsWith("/chat/completions")) {
        return {
          ok: false,
          status: 403,
          text: async () => '{"error":{"code":"403","type":"access_denied"}}',
        };
      }
      if (url.endsWith("/models")) {
        return { ok: true, status: 200, text: async () => '{"data":[]}' };
      }
      throw new Error(`unexpected url ${url}`);
    });
    const r = await probeModelAccess({
      model: "x/y",
      apiKey: "k",
      baseUrl: "https://z/api/v1",
    });
    restore();
    assert.equal(r.ok, false);
    assert.equal(r.code, "forbidden_key_valid");
    assert.equal(r.key_valid, true);
    assert.match(r.hint, /无调用权限|CREW_MOCK/);
    assert.equal("detail" in r, false);
  }

  // 403 on chat 且 /models 也 403 → 普通 forbidden，key 无效。
  {
    stubFetch(() => ({ ok: false, status: 403, text: async () => "denied" }));
    const r = await probeModelAccess({
      model: "x/y",
      apiKey: "k",
      baseUrl: "https://z/api/v1",
    });
    restore();
    assert.equal(r.ok, false);
    assert.equal(r.code, "forbidden");
    assert.equal(r.key_valid, false);
  }

  // 401 → unauthorized。
  {
    stubFetch(() => ({ ok: false, status: 401, text: async () => "bad key" }));
    const r = await probeModelAccess({
      model: "x/y",
      apiKey: "k",
      baseUrl: "https://z/api/v1",
    });
    restore();
    assert.equal(r.ok, false);
    assert.equal(r.code, "unauthorized");
  }

  // 404 → model_not_found，提示里带模型名。
  {
    stubFetch(() => ({
      ok: false,
      status: 404,
      text: async () => "no such model",
    }));
    const r = await probeModelAccess({
      model: "ghost/model",
      apiKey: "k",
      baseUrl: "https://z/api/v1",
    });
    restore();
    assert.equal(r.ok, false);
    assert.equal(r.code, "model_not_found");
    assert.match(r.hint, /ghost\/model|模型/);
  }

  // Provider body 与 endpoint 都可能回显凭据；结构化诊断必须净化。
  {
    const echoedSecret = "PROBE_SECRET_MUST_NOT_ESCAPE";
    stubFetch(url => {
      if (url.endsWith("/chat/completions")) {
        return {
          ok: false,
          status: 403,
          text: async () =>
            `provider echoed Authorization: Bearer ${echoedSecret}`,
        };
      }
      return { ok: false, status: 403, text: async () => echoedSecret };
    });
    const r = await probeModelAccess({
      model: "x/y",
      apiKey: echoedSecret,
      baseUrl: `https://user:${echoedSecret}@z/api/v1`,
    });
    restore();
    assert.doesNotMatch(JSON.stringify(r), new RegExp(echoedSecret));
    assert.equal("baseUrl" in r, false);
    assert.equal("detail" in r, false);
  }

  // Normal Chat errors must classify by status without echoing an arbitrary provider body.
  {
    const echoedSecret = "CALL_SECRET_MUST_NOT_ESCAPE";
    stubFetch(() => ({
      ok: false,
      status: 403,
      text: async () => `provider echoed Authorization: Bearer ${echoedSecret}`,
    }));
    await assert.rejects(
      callModel({
        baseUrl: "https://z/api/v1",
        apiKey: echoedSecret,
        model: "x/y",
        temperature: 0,
        system: "test",
        messages: [{ role: "user", content: "ping" }],
        stream: false,
      }),
      error =>
        /HTTP 403/.test(error.message) &&
        error.code === "forbidden" &&
        error.httpStatus === 403 &&
        !error.message.includes(echoedSecret) &&
        !error.message.includes("Authorization")
    );
    restore();
  }

  // Transport errors carry a stable provider code instead of leaking undici internals.
  {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(
      callModel({
        baseUrl: "https://z/api/v1",
        apiKey: "k",
        model: "x/y",
        temperature: 0,
        system: "test",
        messages: [{ role: "user", content: "ping" }],
        stream: false,
      }),
      error =>
        error.code === "network_error" &&
        /network request failed/.test(error.message)
    );
    restore();
  }

  console.log("model-access.test.mjs ok");
} finally {
  restore();
  if (savedMock === undefined) delete process.env.CREW_MOCK;
  else process.env.CREW_MOCK = savedMock;
}
