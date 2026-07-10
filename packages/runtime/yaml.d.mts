declare const yaml: {
  load(raw: string): unknown;
  dump(value: unknown, options?: Record<string, unknown>): string;
};
export default yaml;
