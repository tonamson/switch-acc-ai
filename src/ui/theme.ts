import pc from "picocolors";

export const enabled = !Object.prototype.hasOwnProperty.call(process.env, "NO_COLOR");

export function brand(value: string): string {
  return enabled ? pc.bold(value) : value;
}

export function heading(value: string): string {
  return enabled ? pc.bold(value) : value;
}

export function muted(value: string): string {
  return enabled ? pc.gray(value) : value;
}

export function command(value: string): string {
  return enabled ? pc.bold(value) : value;
}

export function danger(value: string): string {
  return enabled ? pc.red(value) : value;
}

export function warning(value: string): string {
  return enabled ? pc.yellow(value) : value;
}
