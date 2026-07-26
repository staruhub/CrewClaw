export const orchestrationToolSchemas = [
  {
    type: "function",
    function: {
      name: "todo_write",
      description:
        "Create or update the live task checklist. For tasks with 3 or more concrete steps, call this before execution and keep statuses current as work proceeds.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          todos: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                content: { type: "string", minLength: 1, maxLength: 240 },
                status: {
                  type: "string",
                  enum: ["pending", "in_progress", "completed"],
                },
              },
              required: ["content", "status"],
            },
          },
        },
        required: ["todos"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user",
      description:
        "Pause and ask one structured question when a user choice materially changes the result. Provide 2-4 concise, mutually exclusive options; the UI also accepts free-form input.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string", minLength: 1, maxLength: 500 },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            items: { type: "string", minLength: 1, maxLength: 160 },
          },
        },
        required: ["question", "options"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "note_memory",
      description:
        "Save a non-sensitive memory candidate for later Dream review. This never writes active memory and never bypasses evaluation or human approval.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: {
            type: "string",
            enum: [
              "user_prefs",
              "project_facts",
              "successful_toolchains",
              "failure_paths",
              "reliable_sources",
              "verified_sops",
            ],
          },
          text: { type: "string", minLength: 1, maxLength: 2000 },
          confidence: { type: "string", enum: ["medium", "high"] },
          valid_until: {
            type: "string",
            description:
              "Optional ISO-8601 expiry for time-sensitive knowledge.",
          },
          supersedes: {
            type: "string",
            description:
              "Optional exact older memory text this candidate replaces.",
          },
        },
        required: ["category", "text", "confidence"],
      },
    },
  },
];

export function normalizeTodos(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    throw new TypeError("todo_write.todos 必须包含 1-12 项");
  }
  const seen = new Set();
  return value.map((item, index) => {
    const content = String(item?.content || "").trim();
    const status = String(item?.status || "").trim();
    if (!content || content.length > 240) {
      throw new TypeError(`todo_write.todos[${index}].content 无效`);
    }
    if (!["pending", "in_progress", "completed"].includes(status)) {
      throw new TypeError(`todo_write.todos[${index}].status 无效`);
    }
    const key = content.toLowerCase();
    if (seen.has(key)) throw new TypeError("todo_write 不接受重复步骤");
    seen.add(key);
    return { content, status };
  });
}

export function normalizeQuestion(args) {
  const question = String(args?.question || "").trim();
  const options = Array.isArray(args?.options)
    ? args.options.map(value => String(value || "").trim())
    : [];
  if (!question || question.length > 500) {
    throw new TypeError("ask_user.question 无效");
  }
  if (
    options.length < 2 ||
    options.length > 4 ||
    options.some(option => !option || option.length > 160) ||
    new Set(options.map(option => option.toLowerCase())).size !== options.length
  ) {
    throw new TypeError("ask_user.options 必须是 2-4 个不重复的非空选项");
  }
  return { question, options };
}
