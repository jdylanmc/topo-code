import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface IntegrityBaseline {
  readonly algorithm: "sha256";
  readonly artifact: string;
  readonly sha256: string;
}

export interface PinnedArtifactIntegrity {
  readonly artifact: string;
  readonly sha256: string;
}

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

function readBaseline(rootDirectory: string): IntegrityBaseline {
  const baselinePath = path.join(rootDirectory, "integrity-baseline.json");
  const parsed: unknown = JSON.parse(readFileSync(baselinePath, "utf8"));

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("algorithm" in parsed) ||
    parsed.algorithm !== "sha256" ||
    !("artifact" in parsed) ||
    typeof parsed.artifact !== "string" ||
    !("sha256" in parsed) ||
    typeof parsed.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(parsed.sha256)
  ) {
    throw new Error(`Invalid diagram-core integrity baseline: ${baselinePath}`);
  }

  return {
    algorithm: parsed.algorithm,
    artifact: parsed.artifact,
    sha256: parsed.sha256,
  };
}

export function verifyPinnedArtifactIntegrity(
  rootDirectory = packageRoot,
): PinnedArtifactIntegrity {
  const baseline = readBaseline(rootDirectory);
  const artifactPath = path.resolve(rootDirectory, baseline.artifact);
  const relativeArtifactPath = path.relative(rootDirectory, artifactPath);

  if (
    relativeArtifactPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeArtifactPath)
  ) {
    throw new Error(
      `Diagram-core integrity baseline escapes the package: ${baseline.artifact}`,
    );
  }

  const actualSha256 = createHash("sha256")
    .update(readFileSync(artifactPath))
    .digest("hex");

  if (actualSha256 !== baseline.sha256) {
    throw new Error(
      `Pinned diagram artifact integrity failure for ${baseline.artifact}: expected ${baseline.sha256}, received ${actualSha256}`,
    );
  }

  return {
    artifact: baseline.artifact,
    sha256: actualSha256,
  };
}
