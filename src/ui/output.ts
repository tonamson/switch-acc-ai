import type { ProviderId } from "../core/config.js";
import type { UsageStatus } from "../core/usage.js";
import { brand, command, danger, heading, muted, warning } from "./theme.js";
import {
  colorByLevel,
  formatUsageWindow,
  type FormattedWindow,
} from "./usage-display.js";

export type AccountListRow = {
  profile: string;
  identity: string;
};

export type StatusRenderRow = UsageStatus | { account: string; error: string };

function title(section: string): string {
  return `${brand("Switch Account AI")}  ${muted(section)}`;
}

function cmd(syntax: string, description: string): string {
  return `  ${command(syntax.padEnd(34))}${muted(description)}`;
}

function usage(line: string): string {
  return `  ${command(line)}`;
}

function renderWindow(window: FormattedWindow): string[] {
  const label = muted(window.label.padEnd(10));
  if (window.absent) {
    return [`  ${label}${muted(window.bar)}  ${muted("—")}`];
  }

  const bar = colorByLevel(window.bar, window.level);
  const pct = colorByLevel(window.percentLabel.padStart(5), window.level);
  const lines = [`  ${label}${bar}  ${pct}`];
  if (window.detail) {
    lines.push(`  ${" ".repeat(10)}${muted(window.detail)}`);
  }
  return lines;
}

export function formatHelp(): string {
  return [
    heading("Usage"),
    usage("sacc [command] [provider] [account] [cli args]"),
    "",
    heading("Run"),
    cmd("sacc", "open provider menu"),
    cmd("sacc codex <account> [args]", "run Codex with account"),
    cmd("sacc grok <account> [args]", "run Grok with account"),
    cmd("sacc <account> [args]", "run Codex (compat shortcut)"),
    cmd("sacc pick [args]", "choose Codex account then run"),
    cmd("sacc update", "update sacc from npm"),
    "",
    heading("Accounts"),
    cmd("sacc codex login <name>", "login Codex OAuth into a profile"),
    cmd("sacc grok login <name>", "login Grok OAuth into a profile"),
    cmd("sacc login <name>", "login Codex (compat shortcut)"),
    cmd("sacc codex list", "list Codex accounts"),
    cmd("sacc grok list", "list Grok accounts"),
    cmd("sacc list", "list Codex accounts (compat)"),
    cmd("sacc rename <old> <new>", "rename a Codex account"),
    cmd("sacc remove <name>", "delete a Codex account profile"),
    cmd("sacc codex rename|remove ...", "manage Codex profiles"),
    cmd("sacc grok rename|remove ...", "manage Grok profiles"),
    "",
    heading("Status"),
    cmd("sacc codex status <name>", "unified usage (5h / weekly / monthly)"),
    cmd("sacc grok status <name>", "unified usage (5h / weekly / monthly)"),
    cmd("sacc status --all", "Codex usage for all accounts"),
    cmd("sacc grok status --all", "Grok usage for all accounts"),
  ].join("\n");
}

export function formatAccountsTable(rows: AccountListRow[], provider: ProviderId = "codex"): string {
  const headers = ["profile", "identity"];
  const tableRows = rows.map((row) => [row.profile, row.identity]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...tableRows.map((row) => String(row[index] ?? "").length), 0),
  );
  const renderRow = (cells: string[], isHeader = false) =>
    cells
      .map((cell, index) => {
        const value = String(cell).padEnd(widths[index] || 0);
        if (isHeader) return muted(value);
        return value;
      })
      .join("  ");
  const separator = widths.map((width) => "-".repeat(width || 1)).join("  ");
  const lines = [
    title(`${provider} accounts`),
    `  ${renderRow(headers, true)}`,
    `  ${muted(separator)}`,
    ...tableRows.map((row) => `  ${renderRow(row)}`),
  ];

  return lines.join("\n");
}

/**
 * Unified usage layout for every provider (CLI):
 *
 *   account
 *   user / plan
 *   5h       ████████░░░░░░░░░░  75%
 *            25% left · resets …
 *   weekly / monthly / credits
 */
export function formatStatus(rows: StatusRenderRow[], provider: ProviderId = "codex"): string {
  const blocks = rows.map((row) => {
    if ("error" in row) {
      return [
        `  ${warning(row.account)}`,
        `  ${muted("error".padEnd(10))}${danger(row.error)}`,
      ].join("\n");
    }

    const status = row as UsageStatus;
    const meta = `${status.user}  ·  ${status.plan}`;
    const lines = [
      `  ${heading(status.account)}`,
      `  ${muted(meta)}`,
      "",
      ...renderWindow(formatUsageWindow("5h", status.fiveHour)),
      ...renderWindow(formatUsageWindow("weekly", status.weekly)),
      ...renderWindow(formatUsageWindow("monthly", status.monthly)),
      `  ${muted("credits".padEnd(10))}${status.credits ?? muted("—")}`,
    ];

    if (status.reached) {
      lines.push(`  ${muted("reached".padEnd(10))}${warning(status.reached)}`);
    }
    if (status.note) {
      lines.push(`  ${muted("note".padEnd(10))}${muted(status.note)}`);
    }

    return lines.join("\n");
  });

  return `${title(`${provider} status`)}\n\n${blocks.join("\n\n")}`;
}

export function formatError(message: string, hint?: string): string {
  const lines = [`${danger("error")}  ${message}`];

  if (hint) {
    lines.push(`${muted("hint")}   ${hint}`);
  }

  return lines.join("\n");
}
