import type { RateLimitStatus } from "../core/codex.js";
import { brand, command, danger, heading, muted, warning } from "./theme.js";

export type AccountListRow = {
  profile: string;
  identity: string;
};

export type StatusRenderRow = RateLimitStatus | { account: string; error: string };

function title(section: string): string {
  return `${brand("Switch Account AI")}  ${muted(section)}`;
}

function cmd(syntax: string, description: string): string {
  return `  ${command(syntax.padEnd(28))}${muted(description)}`;
}

function usage(line: string): string {
  return `  ${command(line)}`;
}

function percent(value: string): string {
  const used = Number.parseFloat(value);
  if (Number.isNaN(used)) return value;
  if (used >= 85) return danger(value);
  if (used >= 70) return warning(value);
  return value;
}

export function formatHelp(): string {
  return [
    heading("Usage"),
    usage("sacc [command] [account] [codex args]"),
    "",
    heading("Run"),
    cmd("sacc", "open menu"),
    cmd("sacc <account> [codex args]", "run Codex with account"),
    cmd("sacc pick [codex args]", "choose account then run"),
    cmd("sacc update", "update sacc from npm"),
    "",
    heading("Accounts"),
    cmd("sacc login <name>", "login Codex OAuth into a profile"),
    cmd("sacc list", "list accounts"),
    cmd("sacc rename <old> <new>", "rename an account"),
    cmd("sacc remove <name>", "delete an account profile"),
    "",
    heading("Status"),
    cmd("sacc status <name>", "show one account limits"),
    cmd("sacc status --all", "show limits for all accounts"),
  ].join("\n");
}

export function formatAccountsTable(rows: AccountListRow[]): string {
  const headers = ["profile", "identity"];
  const tableRows = rows.map((row) => [row.profile, row.identity]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...tableRows.map((row) => String(row[index]).length)),
  );
  const renderRow = (cells: string[], isHeader = false) =>
    cells
      .map((cell, index) => {
        const value = String(cell).padEnd(widths[index]);
        if (isHeader) return muted(value);
        return value;
      })
      .join("  ");
  const separator = widths.map((width) => "-".repeat(width)).join("  ");
  const lines = [
    title("Accounts"),
    `  ${renderRow(headers, true)}`,
    `  ${muted(separator)}`,
    ...tableRows.map((row) => `  ${renderRow(row)}`),
  ];

  return lines.join("\n");
}

export function formatStatus(rows: StatusRenderRow[]): string {
  const blocks = rows.map((row) => {
    if ("error" in row) {
      return [`  ${warning(row.account)}`, `  ${muted("error".padEnd(13))}${row.error}`].join("\n");
    }

    const lines = [
      `  ${heading(row.account)}`,
      `  ${muted("user".padEnd(13))}${row.user}`,
      `  ${muted("plan".padEnd(13))}${row.plan}`,
      `  ${muted("5h limit".padEnd(13))}${percent(row.primary.usedPercent)} ${muted(`(${row.primary.resetLabel})`)}`,
      `  ${muted("weekly limit".padEnd(13))}${percent(row.secondary.usedPercent)} ${muted(`(${row.secondary.resetLabel})`)}`,
      `  ${muted("reset credits".padEnd(13))}${row.resetCredits}`,
    ];

    if (row.reached) {
      lines.push(`  ${muted("limit reached".padEnd(13))}${warning(row.reached)}`);
    }

    return lines.join("\n");
  });

  return `${title("Status")}\n${blocks.join("\n\n")}`;
}

export function formatError(message: string, hint?: string): string {
  const lines = [`${danger("error")}  ${message}`];

  if (hint) {
    lines.push(`${muted("hint")}   ${hint}`);
  }

  return lines.join("\n");
}
