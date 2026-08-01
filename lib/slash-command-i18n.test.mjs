import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  lookupSlashCommandDescription,
} = await jiti.import("./slash-command-i18n.ts");

const dict = {
  bySourceName: {
    "skill/skill:brave-search": "Brave 搜索（来源覆盖）",
    "extension/handoff": "交接会话（来源覆盖）",
  },
  byDescription: {
    "Transfer context to a new focused session": "将会话上下文转移到新的聚焦会话",
    "Web search and content extraction via Brave Search API. Use for searching documentation, facts, or any web content. Lightweight, no browser required.":
      "通过 Brave Search API 进行网页搜索与内容提取。",
  },
};

test("source/name override takes precedence over byDescription", () => {
  const result = lookupSlashCommandDescription(
    {
      name: "skill:brave-search",
      source: "skill",
      description:
        "Web search and content extraction via Brave Search API. Use for searching documentation, facts, or any web content. Lightweight, no browser required.",
    },
    "zh-CN",
    dict,
  );
  assert.equal(result, "Brave 搜索（来源覆盖）");
});

test("falls back to exact English description lookup", () => {
  const result = lookupSlashCommandDescription(
    {
      name: "handoff",
      source: "extension",
      description: "Transfer context to a new focused session",
    },
    "zh-CN",
    {
      bySourceName: {},
      byDescription: dict.byDescription,
    },
  );
  assert.equal(result, "将会话上下文转移到新的聚焦会话");
});

test("falls back to byCommandName when source key missing", () => {
  const result = lookupSlashCommandDescription(
    {
      name: "mcp",
      source: "extension",
      description: "Show MCP server status",
    },
    "zh-CN",
    {
      bySourceName: {},
      byDescription: {},
      byCommandName: { mcp: "显示 MCP 服务器状态" },
    },
  );
  assert.equal(result, "显示 MCP 服务器状态");
});

test("unknown descriptions stay in English", () => {
  const original = "Some brand-new command description";
  const result = lookupSlashCommandDescription(
    {
      name: "custom-cmd",
      source: "extension",
      description: original,
    },
    "zh-CN",
    dict,
  );
  assert.equal(result, original);
});

test("missing description returns undefined", () => {
  const result = lookupSlashCommandDescription(
    {
      name: "orphan",
      source: "prompt",
    },
    "zh-CN",
    dict,
  );
  assert.equal(result, undefined);
});

test("English locale bypasses dictionary", () => {
  const original =
    "Web search and content extraction via Brave Search API. Use for searching documentation, facts, or any web content. Lightweight, no browser required.";
  const result = lookupSlashCommandDescription(
    {
      name: "skill:brave-search",
      source: "skill",
      description: original,
    },
    "en",
    dict,
  );
  assert.equal(result, original);
});
