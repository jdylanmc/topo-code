import { readFileSync } from "node:fs";
import { verifyRuntime, type RuntimeIntegrity } from "@jdylanmc/topo-archify";

export type ArchifyIntegrity = RuntimeIntegrity;

export function verifyArchifyIntegrity(): ArchifyIntegrity {
  const pin: Record<string, unknown> = JSON.parse(
    readFileSync(new URL("../archify-pin.json", import.meta.url), "utf8"),
  );
  const integrity = verifyRuntime();
  for (const field of ["repo", "revision", "version", "archiveSha256"] as const) {
    if (integrity[field] !== pin[field]) {
      throw new Error(`Archify package pin mismatch: ${field}`);
    }
  }
  return integrity;
}
