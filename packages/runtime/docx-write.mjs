const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

export const docxToolSchema = {
  type: "function",
  function: {
    name: "docx_write",
    description:
      "Create a real, validated Word .docx document in CrewClaw's managed artifact store. Use only for DOCX output.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          description: "Output filename ending in .docx",
        },
        title: { type: "string", minLength: 1, maxLength: 240 },
        content: {
          type: "string",
          minLength: 1,
          maxLength: 200000,
          description:
            "Plain-text document body; newlines become Word paragraphs.",
        },
      },
      required: ["name", "title", "content"],
    },
  },
};

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function paragraph(text, { bold = false } = {}) {
  const safe = xmlEscape(text);
  const preserve = /^\s|\s$|\s{2}/.test(String(text))
    ? ' xml:space="preserve"'
    : "";
  return `<w:p><w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t${preserve}>${safe}</w:t></w:r></w:p>`;
}

function documentXml(title, content) {
  const body = String(content)
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map(line => paragraph(line || " "))
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraph(title, { bold: true })}${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let k = 0; k < 8; k++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replaceAll("\\", "/"), "utf8");
    const data = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(String(entry.data), "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += local.length + name.length + data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuffer, end]);
}

export function createDocx({ title, content } = {}) {
  const cleanTitle = String(title || "").trim();
  const cleanContent = String(content || "");
  if (!cleanTitle || cleanTitle.length > 240) {
    throw new TypeError("docx_write.title 无效");
  }
  if (!cleanContent.trim() || cleanContent.length > 200000) {
    throw new TypeError("docx_write.content 为空或过长");
  }
  const files = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${DOCX_MIME}"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    { name: "word/document.xml", data: documentXml(cleanTitle, cleanContent) },
  ];
  const buffer = zipStored(files);
  validateDocxBuffer(buffer);
  return buffer;
}

export function validateDocxBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100) {
    throw new Error("DOCX 生成结果为空或过短");
  }
  if (buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("DOCX 不是有效的 OPC ZIP 包");
  }
  const raw = buffer.toString("latin1");
  for (const name of [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
  ]) {
    if (!raw.includes(name)) throw new Error(`DOCX 缺少必需部件 ${name}`);
  }
  if (!raw.includes("wordprocessingml/2006/main")) {
    throw new Error("DOCX 主文档 XML 无效");
  }
  return true;
}
