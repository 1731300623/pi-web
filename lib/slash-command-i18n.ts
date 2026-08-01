/**
 * Locale-aware localization for dynamically loaded slash-command descriptions
 * (extensions, prompt templates, skills). Built-in UI strings stay in lib/i18n.ts.
 */

import { getLocale, type Locale } from "./i18n";
import dictionary from "./slash-command-descriptions.zh-CN.json";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandDescriptionInput {
  name: string;
  description?: string;
  source: SlashCommandSource;
}

export interface SlashCommandDescriptionDictionary {
  bySourceName: Record<string, string>;
  byDescription: Record<string, string>;
  /** Optional fallback keyed by command name alone (e.g. "handoff", "skill:brave-search"). */
  byCommandName?: Record<string, string>;
}

const defaultDictionary = dictionary as SlashCommandDescriptionDictionary;

/** Pure lookup: source/name → command name → exact English description → original. */
export function lookupSlashCommandDescription(
  command: SlashCommandDescriptionInput,
  locale: Locale,
  dict: SlashCommandDescriptionDictionary = defaultDictionary,
): string | undefined {
  const description = command.description;
  if (description === undefined) return undefined;
  if (locale === "en") return description;

  const sourceKey = `${command.source}/${command.name}`;
  return (
    dict.bySourceName[sourceKey] ??
    dict.byCommandName?.[command.name] ??
    dict.byDescription[description] ??
    description
  );
}

/** Public helper bound to the current UI locale from getLocale(). */
export function localizeSlashCommandDescription(
  command: SlashCommandDescriptionInput,
): string | undefined {
  return lookupSlashCommandDescription(command, getLocale());
}

/** Map a get_commands array without mutating the original objects. */
export function localizeSlashCommands<T extends SlashCommandDescriptionInput>(
  commands: T[],
): T[] {
  return commands.map((command) => {
    const description = localizeSlashCommandDescription(command);
    if (description === command.description) return command;
    return { ...command, description };
  });
}
