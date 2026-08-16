import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { ComplexitySensitivity } from "../policy/decide-rewrite.js";

export type NopusConfig = {
  complexitySensitivity: ComplexitySensitivity;
  includeEvidence: boolean;
  pi: {
    hideOriginalResponse: boolean;
  };
};

export function parseComplexitySensitivity(value: unknown, source: string): ComplexitySensitivity {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error(`${source} must be low, medium, or high; received ${JSON.stringify(value)}`);
}

export function parseIncludeEvidence(value: unknown, source: string): boolean {
  if (value === true || value === "true" || value === "on") return true;
  if (value === false || value === "false" || value === "off") return false;
  throw new Error(`${source} must be true or false; received ${JSON.stringify(value)}`);
}

export function defaultConfigPath(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.NOPUS_CONFIG) return environment.NOPUS_CONFIG;
  if (environment.XDG_CONFIG_HOME) return join(environment.XDG_CONFIG_HOME, "nopus", "config.json");
  if (platform() === "win32" && environment.APPDATA) return join(environment.APPDATA, "nopus", "config.json");
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "nopus", "config.json");
  return join(homedir(), ".config", "nopus", "config.json");
}

export function readNopusConfig(path: string = defaultConfigPath()): NopusConfig | undefined {
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  const object = value as Record<string, unknown>;
  if (object.pi !== undefined && (typeof object.pi !== "object" || object.pi === null || Array.isArray(object.pi))) {
    throw new Error(`${path}: pi must be a JSON object`);
  }
  const pi = object.pi as Record<string, unknown> | undefined;
  return {
    complexitySensitivity: object.complexitySensitivity === undefined
      ? "medium"
      : parseComplexitySensitivity(object.complexitySensitivity, `${path}: complexitySensitivity`),
    includeEvidence: object.includeEvidence === undefined
      ? true
      : parseIncludeEvidence(object.includeEvidence, `${path}: includeEvidence`),
    pi: {
      hideOriginalResponse: pi?.hideOriginalResponse === undefined
        ? true
        : parseIncludeEvidence(pi.hideOriginalResponse, `${path}: pi.hideOriginalResponse`),
    },
  };
}

export function configuredNopusConfig(environment: NodeJS.ProcessEnv = process.env): NopusConfig {
  const file = readNopusConfig(defaultConfigPath(environment));
  const explicitSensitivity = environment.NOPUS_COMPLEXITY_SENSITIVITY;
  const explicitEvidence = environment.NOPUS_INCLUDE_EVIDENCE;
  const explicitPiHiding = environment.NOPUS_PI_HIDE_ORIGINAL_RESPONSE;

  return {
    complexitySensitivity: explicitSensitivity !== undefined
      ? parseComplexitySensitivity(explicitSensitivity, "NOPUS_COMPLEXITY_SENSITIVITY")
      : file?.complexitySensitivity ?? "medium",
    includeEvidence: explicitEvidence !== undefined
      ? parseIncludeEvidence(explicitEvidence, "NOPUS_INCLUDE_EVIDENCE")
      : file?.includeEvidence ?? true,
    pi: {
      hideOriginalResponse: explicitPiHiding !== undefined
        ? parseIncludeEvidence(explicitPiHiding, "NOPUS_PI_HIDE_ORIGINAL_RESPONSE")
        : file?.pi.hideOriginalResponse ?? true,
    },
  };
}
