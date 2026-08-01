#!/usr/bin/env python3
"""Replace hardcoded English UI strings with t() calls across Pi Web components."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Exact strings to wrap with t("...") when they appear as JS string literals.
# Longer / more specific strings first is handled by sorting.
STRINGS: list[str] = [
    # AppShell
    "Hide sidebar",
    "Show sidebar",
    "Switch to light mode",
    "Switch to dark mode",
    "View full history",
    "Full history is available after the session is saved",
    "Full history",
    "Generate title",
    "Generate a session title",
    "Title updated",
    "Generation failed",
    "Title generation is available after the session is saved",
    "Send a message before naming this session",
    "System prompt",
    "Session info",
    "Session Info",
    "Hide file panel",
    "Show file panel",
    "Opening workspace...",
    "Unable to open workspace",
    "Get Started",
    "Select a project directory from the sidebar",
    "In-memory",
    "Models",
    "Skills",
    "Plugins",
    "Context",
    "Cost",
    "Tokens",
    "Messages",
    "Input",
    "Output",
    "Cache Read",
    "Cache Write",
    "Total",
    "User",
    "Assistant",
    "Tool Calls",
    "Tool Results",
    "Name",
    "File",
    "ID",
    "Copied",

    # SessionSidebar
    "Select a project first",
    "Select project…",
    "Filter projects…",
    "No matching projects",
    "Use default directory",
    "Custom path…",
    "Switch worktree",
    "Open repo root",
    "Open the repository root to manage worktrees.",
    "Git repo root only",
    "Worktrees are available in Git repository roots.",
    "Checking worktrees for this directory.",
    "Worktrees...",
    "Create a worktree checkout for a branch",
    "New worktree…",
    "branch name",
    "Upload files to project root",
    "Upload files",
    "Refresh explorer",
    "Agent running…",
    "Agent running",
    "New activity",
    "New session activity",
    "Expand forks",
    "Collapse forks",
    "just now",
    "Refresh",
    "Rename",
    "Delete",
    "Open",
    "Checking…",
    "Create",
    "Creating…",
    "main",

    # ChatInput
    "Message… Type / for commands, @ for files",
    "Steer now / queue follow-up...",
    "Agent is running…",
    "Attach image",
    "More controls",
    "Change reasoning level",
    "Change tool preset",
    "Compact context",
    "Stop compaction",
    "Stop agent",
    "Disable completion sound",
    "Enable completion sound",
    "Collapse controls",
    "Image attachments cannot be queued while the agent is running",
    "Interrupt the current run and inject this message now",
    "Queue this message after the agent finishes",
    "Remove all queued messages and put them back into the input box for editing",
    "Use pi default",
    "Reasoning off",
    "Minimal reasoning",
    "Low reasoning",
    "Medium reasoning",
    "High reasoning",
    "Extra-high reasoning",
    "Max reasoning",
    "No tools, read-only",
    "4 built-in tools",
    "All built-in tools",
    "Built-in",
    "Extensions",
    "Prompts",
    "Themes",
    "Loading commands...",
    "Loading files...",
    "No matching files",
    "Searching…",
    "Compress context, optionally with instructions",
    "Reload extensions, skills, prompts, and tools",
    "Set the session display name",
    "Show session message, token, and cost stats",
    "Copy the last assistant message",
    "Compacted",
    "Compact",
    "Compacting…",

    # ChatWindow
    "Running tool...",
    "Waiting for model...",
    "Running command...",
    "Process details",
    "Collapse process details",
    "Expand process details",
    "Extension terminal input",
    "Extension panel",
    "extension request",

    # MessageView
    "Edit from here — branches within this session",
    "New session — creates an independent copy from here",
    "New session",
    "Creating new session…",
    "Estimated token count while streaming",
    "Modified files",
    "Read files",
    "hidden extension message",
    "Show extension message",
    "Invalid thinking response",
    "Thinking content unavailable",
    "loading…",
    "view full output",
    "bash (local)",
    "Copy message",
    "Thinking",
    "Before",
    "After",
    "Expand",
    "Collapse",
    "Show details",
    "Hide details",
    "Copy",

    # BranchNavigator
    "No active session",
    "This session has no branches",
    "Branches",

    # FileExplorer
    "Modified",
    "Added",
    "Deleted",
    "Renamed",
    "Untracked",
    "Conflict",
    "Newly uploaded",
    "Contains changed files",
    "Insert path into chat",
    "Download file",
    "Checking files",
    "Dismiss error",
    "Dismiss upload results",
    "Add uploaded file to chat",
    "Add all uploaded files to chat",
    "Network error while uploading files",
    "Upload cancelled",

    # FileViewer
    "Live sync active",
    "Not watching",
    "Compare working tree with HEAD",
    "Disable word wrap",
    "Enable word wrap",
    "HTML preview",
    "File view mode",
    "Failed to load audio",
    "Failed to load image",
    "Preview",
    "Source",
    "Diff",

    # MarkdownBody
    "Invalid Mermaid diagram",
    "Preview Mermaid diagram",
    "Preview available after streaming",
    "Show Mermaid source",
    "Rendering Mermaid diagram",

    # ModelsConfig
    "Hide API key",
    "Show API key",
    "Test model connection",
    "Thinking level map",
    "Cost (per million tokens)",
    "Opening browser…",
    "Connected successfully.",
    "Search providers…",
    "No providers match",
    "OpenAI / Anthropic compatible",
    "Custom endpoint format",
    "ID *",
    "Display name",
    "Provider name",
    "API override",
    "Context window (tokens)",
    "Max output tokens",
    "Image input",
    "Reasoning / thinking",
    "DeepSeek thinking compat",
    "Already connected. You can re-login or disconnect.",
    "API key is stored. Enter a new key below to replace it, or disconnect to remove it.",
    "Complete sign-in in the browser, then copy the redirect URL from the address bar and paste it below.",
    "Enter new key to replace…",
    "Enter value…",
    "Connection lost",
    "Continuing…",
    "Verifying…",
    "Network error",
    "not configured",
    "not connected",
    "new model",
    "API Key",
    "API",
    "Base URL",
    "Subscription",
    "Subscriptions",
    "OAuth",
    "Custom",
    "Provider",
    "Model",
    "Login",
    "Disconnect",
    "Re-login",
    "Connected",
    "Save",
    "Saved",
    "Saving…",
    "Test",
    "Testing…",
    "Failed",
    "Removing…",
    "Loading…",
    "OK",

    # PluginsConfig
    "Disabled",
    "No resources",
    "No resolved resources",
    "Package disabled",
    "Enable package",
    "Disable package",
    "Reload current session",
    "Open a session to reload",
    "Reload session",
    "Reloading...",
    "Package removed.",
    "Package installed.",
    "Package updated.",
    "Package disabled.",
    "Package enabled.",
    "Session reloaded.",
    "Installed path",
    "Status",
    "Version",
    "Package",
    "Resources",
    "Cwd",
    "Unknown",
    "Not found",
    "Install",
    "Installing...",
    "Update",
    "Updating...",
    "Remove",
    "Removing...",

    # SkillsConfig
    "Visible in model prompt — click to disable",
    "Hidden from model prompt — click to enable",
    "Up to date",
    "Automatic checks unavailable",
    "Check failed",
    "Check updates",
    "Update available",
    "No skills found",
    "e.g. react, testing, deploy",
    "project / skills.sh",
    "global / skills.sh",
    "✓ Installed",
    "Search",
    "Installing…",
    "Checking...",

    # TabBar
    "Close",

    # Agent session
    "Command completed",
    "Command failed",
    "Compacted context",
    "Copied last assistant message",
    "Extension command failed",
    "Failed to abort bash:",
    "Failed to abort compaction:",
    "Failed to abort:",
    "Failed to connect to the agent event stream. Please try again.",
    "Failed to execute shell command:",
    "Failed to follow up:",
    "Failed to load agent state:",
    "Failed to load context:",
    "Failed to load slash commands:",
    "Failed to load tools:",
    "Failed to queue prompt:",
    "Failed to recall queued messages",
    "Failed to recall queued messages:",
    "Failed to send extension UI response:",
    "Failed to send extension custom UI input:",
    "Failed to send message:",
    "Failed to set model:",
    "Failed to set thinking level:",
    "Failed to set tools:",
    "Failed to steer:",
    "Fork failed:",
    "No active session to compact",
    "No active session to name",
    "No active session to reload",
    "No assistant message to copy",
    "Reloaded session resources",
    "Timed out connecting to the agent event stream. Please try again.",
    "Unable to create a session for the shell command",
]

# Sort longest first so nested/substring replacements don't corrupt longer keys.
STRINGS = sorted(set(STRINGS), key=len, reverse=True)

FILES = [
    "components/AppShell.tsx",
    "components/SessionSidebar.tsx",
    "components/ChatInput.tsx",
    "components/ChatWindow.tsx",
    "components/MessageView.tsx",
    "components/BranchNavigator.tsx",
    "components/FileExplorer.tsx",
    "components/FileViewer.tsx",
    "components/MarkdownBody.tsx",
    "components/ModelsConfig.tsx",
    "components/PluginsConfig.tsx",
    "components/SkillsConfig.tsx",
    "components/TabBar.tsx",
    "hooks/useAgentSession.ts",
]

IMPORT_LINE = 'import { t } from "@/lib/i18n";'


def escape_for_double(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def already_wrapped(text: str, start: int, end: int) -> bool:
    # Look behind for t( immediately before the quote
    before = text[max(0, start - 4):start]
    return bool(re.search(r"\bt\(\s*$", before))


def replace_string_literals(text: str) -> tuple[str, int]:
    count = 0
    for s in STRINGS:
        for quote in ('"', "'"):
            lit = f"{quote}{s}{quote}"
            # Build replacement using double quotes inside t()
            repl = f't("{escape_for_double(s)}")'
            idx = 0
            while True:
                pos = text.find(lit, idx)
                if pos < 0:
                    break
                end = pos + len(lit)
                if already_wrapped(text, pos, end):
                    idx = end
                    continue
                # Skip import paths / package names / css-like contexts lightly:
                # if the string is part of from "..." leave alone - our strings don't match those.
                text = text[:pos] + repl + text[end:]
                count += 1
                idx = pos + len(repl)
    return text, count


def ensure_import(text: str) -> str:
    if 'from "@/lib/i18n"' in text or "from '@/lib/i18n'" in text:
        return text
    # Insert after the last import line at the top
    lines = text.splitlines(keepends=True)
    last_import = -1
    for i, line in enumerate(lines):
        if line.startswith("import ") or line.startswith("import{"):
            last_import = i
        elif last_import >= 0 and line.strip() and not line.startswith("import ") and not line.startswith("//") and not line.startswith("/*") and not line.startswith("*") and not line.startswith(" type ") and "from " not in line:
            # allow blank lines between imports
            if line.strip() == "":
                continue
            break
    if last_import >= 0:
        # find end of import block
        insert_at = last_import + 1
        while insert_at < len(lines) and (lines[insert_at].startswith("import ") or lines[insert_at].strip() == "" or lines[insert_at].startswith("}")):
            if lines[insert_at].startswith("import "):
                insert_at += 1
                continue
            if lines[insert_at].strip() == "":
                break
            insert_at += 1
        lines.insert(insert_at, IMPORT_LINE + "\n")
        return "".join(lines)
    return IMPORT_LINE + "\n" + text


def patch_relative_time(text: str) -> str:
    old = '''function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}'''
    # more flexible match
    pat = re.compile(
        r"function formatRelativeTime\(dateStr: string\): string \{.*?\n\}",
        re.S,
    )
    new = '''function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 1) return t("just now");
  if (mins < 60) return `${mins}${t("m ago")}`;
  if (hours < 24) return `${hours}${t("h ago")}`;
  if (days < 7) return `${days}${t("d ago")}`;
  return d.toLocaleDateString("zh-CN");
}'''
    if pat.search(text):
        return pat.sub(new, text, count=1)
    return text


def patch_templates(text: str, path: str) -> str:
    replacements = [
        # SessionSidebar
        (
            'title={selectedCwd ? `New session in ${selectedCwd}` : t("Select a project first")}',
            'title={selectedCwd ? `${t("New session in")} ${selectedCwd}` : t("Select a project first")}',
        ),
        (
            'title={currentWt ? `Switch worktree: ${currentWt.path}` : t("Switch worktree")}',
            'title={currentWt ? `${t("Switch worktree:")} ${currentWt.path}` : t("Switch worktree")}',
        ),
        (
            "title={`Remove worktree checkout ${wt.path}; the branch is kept`}",
            'title={`${t("Remove worktree checkout")} ${wt.path}; ${t("the branch is kept")}`}',
        ),
        (
            "title={`Worktree: ${session.cwd}`}",
            'title={`${t("Worktree:")} ${session.cwd}`}',
        ),
        # ChatInput
        (
            "title={`Change reasoning level: ${thinkingDisplayLabel}`}",
            'title={`${t("Change reasoning level:")} ${thinkingDisplayLabel}`}',
        ),
        (
            "title={`Change tool preset: ${toolPresetLabel}`}",
            'title={`${t("Change tool preset:")} ${toolPresetLabel}`}',
        ),
        # TabBar
        (
            "aria-label={`Close ${tab.label}`}",
            'aria-label={`${t("Close")} ${tab.label}`}',
        ),
        # FileExplorer upload progress
        (
            'aria-label={uploadPhase === "checking" ? t("Checking files") : `Uploading, ${uploadProgress}%`}',
            'aria-label={uploadPhase === "checking" ? t("Checking files") : `${t("Uploading,")} ${uploadProgress}%`}',
        ),
        (
            "title={`${uploadSummary.uploaded.length} uploaded`}",
            'title={`${uploadSummary.uploaded.length} ${t("uploaded")}`}',
        ),
        (
            "aria-label={`${uploadSummary.uploaded.length} uploaded`}",
            'aria-label={`${uploadSummary.uploaded.length} ${t("uploaded")}`}',
        ),
        (
            "title={`${uploadSummary.skipped.length} skipped`}",
            'title={`${uploadSummary.skipped.length} ${t("skipped")}`}',
        ),
        (
            "aria-label={`${uploadSummary.skipped.length} skipped`}",
            'aria-label={`${uploadSummary.skipped.length} ${t("skipped")}`}',
        ),
        (
            "title={`${uploadSummary.errors.length} failed`}",
            'title={`${uploadSummary.errors.length} ${t("failed")}`}',
        ),
        (
            "aria-label={`${uploadSummary.errors.length} failed`}",
            'aria-label={`${uploadSummary.errors.length} ${t("failed")}`}',
        ),
        # FileViewer preview title
        (
            "title={`Preview ${getFileName(filePath)}`}",
            'title={`${t("Preview")} ${getFileName(filePath)}`}',
        ),
    ]
    for old, new in replacements:
        if old in text:
            text = text.replace(old, new)
    return text


def patch_jsx_text(text: str) -> str:
    """Wrap simple JSX text nodes that are exact known phrases."""
    # >Full history< etc.
    jsx_phrases = [
        "Full history",
        "System",
        "Get Started",
        "Opening workspace...",
        "Unable to open workspace",
        "Select a project directory from the sidebar",
        "Session Info",
        "Branches",
        "Thinking",
        "Loading files...",
        "Loading…",
        "Use default directory",
        "Custom path…",
        "No matching projects",
        "New worktree…",
        "main",
        "Models",
        "Provider",
        "Model",
        "Subscription",
        "Subscriptions",
        "API Key",
        "Custom",
        "OAuth",
        "OpenAI / Anthropic compatible",
        "Custom endpoint format",
        "No providers match",
        "Search providers…",
        "Opening browser…",
        "Connected successfully.",
        "Thinking level map",
        "Cost (per million tokens)",
        "Status",
        "Version",
        "Package",
        "Resources",
        "Installed path",
        "Cwd",
        "Extension panel",
        "extension request",
        "hidden extension message",
        "Process details",
        "Running command...",
        "Invalid Mermaid diagram",
        "Tab / Enter",
        "Compact",
        "Compacting…",
    ]
    for phrase in sorted(set(jsx_phrases), key=len, reverse=True):
        # >phrase<  -> >{t("phrase")}<
        pattern = re.compile(rf">({re.escape(phrase)})<")
        text, n = pattern.subn(lambda m: f'>{{t("{escape_for_double(m.group(1))}")}}<', text)
    return text


def main() -> None:
    total = 0
    for rel in FILES:
        path = ROOT / rel
        original = path.read_text(encoding="utf-8")
        text = original
        text, n = replace_string_literals(text)
        text = patch_templates(text, rel)
        text = patch_jsx_text(text)
        if rel.endswith("SessionSidebar.tsx"):
            text = patch_relative_time(text)
        if n > 0 or text != original:
            text = ensure_import(text)
            path.write_text(text, encoding="utf-8")
            print(f"{rel}: ~{n} string replacements")
            total += n
        else:
            print(f"{rel}: no changes")
    print(f"Total literal replacements: {total}")


if __name__ == "__main__":
    main()
