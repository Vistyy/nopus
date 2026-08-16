import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  defaultConfigPath,
  parseComplexitySensitivity,
  parseIncludeEvidence,
  readNopusConfig,
  type NopusConfig,
} from "./nopus-config.js";

export type ConfigUpdate = {
  config: NopusConfig;
  confirmation: string;
  path: string;
};

export function updateNopusConfig(
  args: string[],
  path: string = defaultConfigPath(),
): ConfigUpdate {
  const config: NopusConfig = readNopusConfig(path) ?? {
    complexitySensitivity: "medium",
    includeEvidence: true,
    extraSimple: false,
    pi: { hideOriginalResponse: true },
  };
  const [first, second] = args;
  let confirmation: string;

  if (first === "evidence") {
    config.includeEvidence = parseIncludeEvidence(second, "include evidence");
    confirmation = `nopus rewrite evidence is ${config.includeEvidence ? "on" : "off"}.`;
  } else if (first === "extra-simple") {
    config.extraSimple = parseIncludeEvidence(second, "extra-simple rewrites");
    confirmation = `nopus extra-simple rewrites are ${config.extraSimple ? "on" : "off"}.`;
  } else if (first === "hide-original") {
    config.pi.hideOriginalResponse = parseIncludeEvidence(second, "hide original Pi response");
    confirmation = `nopus Pi response hiding is ${config.pi.hideOriginalResponse ? "on" : "off"}.`;
  } else {
    const value = first === "sensitivity" ? second : first;
    config.complexitySensitivity = parseComplexitySensitivity(value, "complexity sensitivity");
    confirmation = `nopus complexity sensitivity is ${config.complexitySensitivity}.`;
  }

  const temporaryPath = `${path}.${process.pid}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
  return { config, confirmation, path };
}
