import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface IntegrityManifest {
  readonly algorithm: "sha256";
  readonly files: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
}

interface ArchifyPin {
  readonly repo: string;
  readonly revision: string;
  readonly version: string;
  readonly archiveSha256: string;
}

export interface VendoredArchifyIntegrity extends ArchifyPin {
  readonly files: number;
}

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const SHA256 = /^[0-9a-f]{64}$/;

function readManifest(rootDirectory: string): IntegrityManifest {
  const manifestPath = path.join(rootDirectory, "archify-integrity.json");
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("algorithm" in parsed) ||
    parsed.algorithm !== "sha256" ||
    !("files" in parsed) ||
    !Array.isArray(parsed.files) ||
    parsed.files.some((entry: unknown) =>
      typeof entry !== "object" ||
      entry === null ||
      !("path" in entry) ||
      typeof entry.path !== "string" ||
      !entry.path.startsWith("vendor/archify/") ||
      !("sha256" in entry) ||
      typeof entry.sha256 !== "string" ||
      !SHA256.test(entry.sha256)
    )
  ) {
    throw new Error(`Invalid vendored Archify integrity manifest: ${manifestPath}`);
  }

  return {
    algorithm: parsed.algorithm,
    files: parsed.files,
  };
}

function readPin(rootDirectory: string): ArchifyPin {
  const pinPath = path.join(rootDirectory, "vendor", "archify", "PIN.json");
  const parsed: unknown = JSON.parse(readFileSync(pinPath, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("repo" in parsed) ||
    parsed.repo !== "github.com/tt-a1i/archify" ||
    !("revision" in parsed) ||
    parsed.revision !== "d673e8300df60a5c8166abe78787fdc78f6b8000" ||
    !("version" in parsed) ||
    parsed.version !== "2.17.0-dev.1" ||
    !("archiveSha256" in parsed) ||
    typeof parsed.archiveSha256 !== "string" ||
    !SHA256.test(parsed.archiveSha256)
  ) {
    throw new Error(`Invalid vendored Archify pin: ${pinPath}`);
  }
  return {
    repo: parsed.repo,
    revision: parsed.revision,
    version: parsed.version,
    archiveSha256: parsed.archiveSha256,
  };
}

function vendoredFiles(directory: string, rootDirectory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const candidate = path.join(directory, entry.name);
      return entry.isDirectory()
        ? vendoredFiles(candidate, rootDirectory)
        : [path.relative(rootDirectory, candidate).split(path.sep).join("/")];
    });
}

export function verifyVendoredArchifyIntegrity(
  rootDirectory = packageRoot,
): VendoredArchifyIntegrity {
  const manifest = readManifest(rootDirectory);
  const pin = readPin(rootDirectory);
  const expectedPaths = manifest.files.map((entry) => entry.path);
  const actualPaths = vendoredFiles(
    path.join(rootDirectory, "vendor", "archify"),
    rootDirectory,
  );
  if (
    expectedPaths.length !== actualPaths.length ||
    expectedPaths.some((entry, index) => entry !== actualPaths[index])
  ) {
    throw new Error(
      "Vendored Archify integrity failure: file inventory differs from archify-integrity.json",
    );
  }

  for (const entry of manifest.files) {
    const actualSha256 = createHash("sha256")
      .update(readFileSync(path.join(rootDirectory, entry.path)))
      .digest("hex");
    if (actualSha256 !== entry.sha256) {
      throw new Error(
        `Vendored Archify integrity failure for ${entry.path}: expected ${entry.sha256}, received ${actualSha256}`,
      );
    }
  }

  return {
    ...pin,
    files: manifest.files.length,
  };
}
