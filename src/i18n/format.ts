export type MessageValues = Record<string, string | number>;
export type MessageCatalog = Record<string, string>;
export type LocalizedCatalog = Record<"en" | "zh-CN", MessageCatalog>;

export function formatMessage(message: string, values: MessageValues = {}) {
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? String(values[key])
      : match
  );
}

export function defineCatalog<
  const English extends MessageCatalog,
  const Chinese extends { [Key in keyof English]: string },
>(en: English, zhCN: Chinese) {
  return { en, "zh-CN": zhCN };
}
