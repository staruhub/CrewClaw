// v0.8 M6：把 TUI 的结构化 parts[] 展开成 model 的 content。单一事实源——plain CLI 与 TUI 吃同一份，
// 杜绝附件展开逻辑分叉（PRD v0.7 §3.3 设计点）。
//
// 输入 parts 形状（来自 user.message.data.parts）：
//   {type:"text", text}                         → 文本块
//   {type:"image", media_type, data_url}        → 已就绪的 base64 图片（Rust 剪贴板路径）
//   {type:"file", path}                         → 文件路径，读取留给引擎（readAnyFile / readImageDataUrl）
//
// 返回：
//   - 纯文本（无 image/file，或全部读取失败降级）→ string（session-store JSON 兼容）
//   - 含附件 → [{type:"text",text}, {type:"image_url",image_url:{url}}, ...]（复用 run.mjs 已验证格式）

import { readAnyFile, readImageDataUrl, isImagePath } from "../tools-files.mjs";

/**
 * @param {{text?:string, parts?:Array}} message
 * @param {{root?:string}} opts
 * @returns {Promise<string | Array>} string（纯文本降级）或 content-block 数组
 */
export async function expandPartsToContent(message, { root } = {}) {
  const text = String(message?.text ?? "");
  const parts = Array.isArray(message?.parts) ? message.parts : null;
  if (!parts || parts.length === 0) {
    return text; // 无 parts → 纯文本路径，逐字节等价于旧行为
  }

  const imageBlocks = [];
  const fileTexts = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "image" && typeof part.data_url === "string" && part.data_url) {
      imageBlocks.push({ type: "image_url", image_url: { url: part.data_url } });
    } else if (part.type === "file" && typeof part.path === "string" && part.path) {
      if (isImagePath(part.path)) {
        const img = await readImageDataUrl(part.path);
        if (img.ok) {
          imageBlocks.push({ type: "image_url", image_url: { url: img.dataUrl } });
        } else {
          fileTexts.push(`（读取图片失败 ${part.path}：${img.error}）`);
        }
      } else {
        const f = await readAnyFile(part.path, { root });
        if (f.ok) {
          fileTexts.push(f.text);
        } else {
          fileTexts.push(`（读取文件失败 ${part.path}：${f.error}）`);
        }
      }
    }
    // type:"text" part 忽略——降级文本 message.text 已含全文（占位块在 Rust 侧已展开进 text）。
  }

  if (imageBlocks.length === 0 && fileTexts.length === 0) {
    return text; // 附件全失败/无有效附件 → 纯文本降级
  }

  const combinedText = fileTexts.length
    ? fileTexts.join("\n\n") + "\n\n---\n用户消息：" + text
    : text;

  if (imageBlocks.length) {
    return [{ type: "text", text: combinedText }, ...imageBlocks];
  }
  // 只有文件文本、无图片 → 仍是纯 string（含附件正文），走 history string 路径。
  return combinedText;
}
