import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ScanError,
  ScanInputError,
  type ScannerAdapter,
} from "./types.js";

export interface ConformanceResult {
  name: string;
  passed: boolean;
}

async function expectReject(
  action: () => Promise<unknown>,
  errorType: typeof ScanError | typeof ScanInputError,
): Promise<boolean> {
  try {
    await action();
    return false;
  } catch (error) {
    return error instanceof errorType;
  }
}

export async function runScannerConformance(
  adapter: ScannerAdapter,
): Promise<ConformanceResult[]> {
  const root = await mkdtemp(path.join(os.tmpdir(), "topo-conformance-"));
  try {
    const empty = path.join(root, "empty");
    const cargo = path.join(root, "cargo");
    await mkdir(empty);
    await mkdir(cargo);
    await writeFile(
      path.join(cargo, "Cargo.toml"),
      '[workspace]\nmembers = ["crate-a"]\n',
    );

    return [
      {
        name: "rejects plausible invalid adapter input",
        passed: await expectReject(
          () => adapter.scan({ root, quality: { allowPartial: "yes" } }),
          ScanInputError,
        ),
      },
      {
        name: "rejects an empty directory",
        passed: await expectReject(() => adapter.scan({ root: empty }), ScanError),
      },
      {
        name: "rejects an unsupported Cargo workspace",
        passed: await expectReject(() => adapter.scan({ root: cargo }), ScanError),
      },
    ];
  } finally {
    await rm(root, { recursive: true });
  }
}

export async function assertScannerConformance(
  adapter: ScannerAdapter,
): Promise<void> {
  const results = await runScannerConformance(adapter);
  const failures = results.filter((result) => !result.passed);
  if (failures.length > 0) {
    throw new Error(
      `Scanner conformance failed: ${failures.map((failure) => failure.name).join(", ")}.`,
    );
  }
}
