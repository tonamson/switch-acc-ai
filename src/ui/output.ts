import type { RateLimitStatus } from "../core/codex.js";
import { brand, command, danger, heading, muted, warning } from "./theme.js";

export type AccountListRow = {
  marker: "*" | "-";
  profile: string;
  identity: string;
};

export type StatusRenderRow = RateLimitStatus | { account: string; error: string };

function statusTitle(row: RateLimitStatus): string {
  return row.current ? `${row.account} current` : row.account;
}

function title(section: string): string {
  return `${brand("SWA")}  ${muted(section)}`;
}

function cmd(syntax: string, description: string): string {
  return `  ${command(syntax.padEnd(28))}${muted(description)}`;
}

function usage(line: string): string {
  return `  ${command(line)}`;
}

function currentMarker(value: string): string {
  return value === "*" ? warning("*") : muted("-");
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
    `${brand("SWA")}  ${muted("Codex account switcher")}`,
    "",
    heading("Usage"),
    usage("swa [command] [account] [codex args]"),
    "",
    heading("Run"),
    cmd("swa", "open menu"),
    cmd("swa <account> [codex args]", "run Codex with account"),
    cmd("swa run [codex args]", "run current account"),
    cmd("swa pick [codex args]", "choose account then run"),
    cmd("swa resume <id> [args]", "resume current account"),
    "",
    heading("Accounts"),
    cmd("swa login <name>", "login Codex OAuth into a profile"),
    cmd("swa use <name>", "set current account"),
    cmd("swa current", "print current account"),
    cmd("swa list", "list accounts"),
    cmd("swa rename <old> <new>", "rename an account"),
    cmd("swa remove <name>", "delete an account profile"),
    "",
    heading("Status"),
    cmd("swa status", "show current account limits"),
    cmd("swa status <name>", "show one account limits"),
    cmd("swa status --all", "show limits for all accounts"),
  ].join("\n");
}

export function formatAccountsTable(rows: AccountListRow[]): string {
  const headers = ["use", "profile", "identity"];
  const tableRows = rows.map((row) => [row.marker, row.profile, row.identity]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...tableRows.map((row) => String(row[index]).length)),
  );
  const renderRow = (cells: string[], isHeader = false) =>
    cells
      .map((cell, index) => {
        const value = String(cell).padEnd(widths[index]);
        if (isHeader) return muted(value);
        if (index === 0) return currentMarker(cell);
        if (index === 1 && cells[0] === "*") return command(value);
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
      `  ${heading(statusTitle(row))}`,
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
