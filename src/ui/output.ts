import type { RateLimitStatus } from "../core/codex.js";
import { brand, danger, heading, muted, warning } from "./theme.js";

export type AccountListRow = {
  marker: "*" | "-";
  profile: string;
  identity: string;
};

export type StatusRenderRow = RateLimitStatus | { account: string; error: string };

function statusTitle(row: RateLimitStatus): string {
  return row.current ? `${row.account} current` : row.account;
}

export function formatHelp(): string {
  return [
    `${brand("SWA")}  ${muted("Codex account switcher")}`,
    "",
    heading("Run"),
    "  swa                         open menu",
    "  swa <account> [codex args]   run Codex with account",
    "  swa run [codex args]         run current account",
    "  swa pick [codex args]        choose account then run",
    "  swa resume <id> [args]       resume current account",
    "",
    heading("Accounts"),
    "  swa login <name>             login Codex OAuth into a profile",
    "  swa use <name>               set current account",
    "  swa current                  print current account",
    "  swa list                     list accounts",
    "  swa rename <old> <new>       rename an account",
    "  swa remove <name>            delete an account profile",
    "",
    heading("Status"),
    "  swa status                   show current account limits",
    "  swa status <name>            show one account limits",
    "  swa status --all             show limits for all accounts",
  ].join("\n");
}

export function formatAccountsTable(rows: AccountListRow[]): string {
  const headers = ["use", "profile", "identity"];
  const tableRows = rows.map((row) => [row.marker, row.profile, row.identity]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...tableRows.map((row) => String(row[index]).length)),
  );
  const renderRow = (cells: string[]) =>
    cells.map((cell, index) => String(cell).padEnd(widths[index])).join("  ");
  const separator = widths.map((width) => "-".repeat(width)).join("  ");
  const lines = [heading("Accounts"), renderRow(headers), separator, ...tableRows.map(renderRow)];

  return lines.join("\n");
}

export function formatStatus(rows: StatusRenderRow[]): string {
  const blocks = rows.map((row) => {
    if ("error" in row) {
      return [warning(row.account), `  error         ${row.error}`].join("\n");
    }

    const lines = [
      heading(statusTitle(row)),
      `  user          ${row.user}`,
      `  plan          ${row.plan}`,
      `  5h limit      ${row.primary.usedPercent} (${row.primary.resetLabel})`,
      `  weekly limit  ${row.secondary.usedPercent} (${row.secondary.resetLabel})`,
      `  reset credits ${row.resetCredits}`,
    ];

    if (row.reached) {
      lines.push(`  limit reached ${row.reached}`);
    }

    return lines.join("\n");
  });

  return `${heading("Status")}\n${blocks.join("\n\n")}`;
}

export function formatError(message: string, hint?: string): string {
  const lines = [`${danger("error")}  ${message}`];

  if (hint) {
    lines.push(`${muted("hint")}   ${hint}`);
  }

  return lines.join("\n");
}
