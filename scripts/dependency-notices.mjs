import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const ALLOWED_LICENSES = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "Python-2.0",
  "Unlicense",
]);

const LICENSE_FILE_PATTERN = /^(?:licen[cs]e|copying)(?:[._-].*)?$/i;
const NOTICE_FILE_PATTERN = /^notice(?:[._-].*)?$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_URL_PATTERN =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{40})$/;

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeAttributionText(content) {
  return content.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "");
}

function dependencyEntries(manifest, kind) {
  const values =
    kind === "required"
      ? manifest.dependencies
      : kind === "optional"
        ? manifest.optionalDependencies
        : manifest.peerDependencies;
  return Object.entries(values ?? {}).sort(([left], [right]) =>
    compareCodeUnits(left, right),
  );
}

async function pathExists(candidate) {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readManifest(manifestPath) {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

async function findInstalledManifest(name, fromManifestPath, rootDirectory) {
  let directory = path.dirname(fromManifestPath);
  const packageParts = name.split("/");

  while (true) {
    const candidate = path.join(
      directory,
      "node_modules",
      ...packageParts,
      "package.json",
    );
    if (await pathExists(candidate)) {
      return candidate;
    }
    if (directory === rootDirectory) {
      return undefined;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    if (path.relative(rootDirectory, parent).startsWith("..")) {
      return undefined;
    }
    directory = parent;
  }
}

async function readAttributionFiles(packageDirectory) {
  const entries = await readdir(packageDirectory, { withFileTypes: true });
  const files = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        (LICENSE_FILE_PATTERN.test(entry.name) ||
          NOTICE_FILE_PATTERN.test(entry.name)),
    )
    .map((entry) => entry.name)
    .sort(compareCodeUnits);
  const texts = [];

  for (const file of files) {
    const content = await readFile(path.join(packageDirectory, file), "utf8");
    if (content.includes("\0")) {
      throw new Error(`${file} contains binary data.`);
    }
    texts.push({
      file,
      kind: NOTICE_FILE_PATTERN.test(file) ? "notice" : "license",
      content: normalizeAttributionText(content),
    });
  }

  return texts;
}

async function readLicenseOverrides(rootDirectory) {
  const overrideDirectory = path.join(rootDirectory, "licenses", "third-party");
  const manifestPath = path.join(overrideDirectory, "overrides.json");
  if (!(await pathExists(manifestPath))) {
    return new Map();
  }

  const manifest = await readManifest(manifestPath);
  if (manifest.version !== 1 || !Array.isArray(manifest.overrides)) {
    throw new Error(
      "licenses/third-party/overrides.json must contain version 1 and an overrides array.",
    );
  }

  const overrides = new Map();
  for (const override of manifest.overrides) {
    const requiredStrings = [
      "name",
      "version",
      "spdx",
      "licenseFile",
      "sha256",
      "sourceRepository",
      "sourceCommitUrl",
      "sourceLicenseUrl",
      "packageMetadataUrl",
    ];
    for (const field of requiredStrings) {
      if (typeof override[field] !== "string" || override[field].length === 0) {
        throw new Error(`License override has invalid ${field}.`);
      }
    }

    const identity = `${override.name}@${override.version}`;
    if (overrides.has(identity)) {
      throw new Error(`Duplicate license override for ${identity}.`);
    }
    if (!ALLOWED_LICENSES.has(override.spdx)) {
      throw new Error(
        `${identity} override uses unapproved license "${override.spdx}".`,
      );
    }
    if (
      path.basename(override.licenseFile) !== override.licenseFile ||
      override.licenseFile === "." ||
      override.licenseFile === ".."
    ) {
      throw new Error(`${identity} override licenseFile must be a file name.`);
    }
    if (!SHA256_PATTERN.test(override.sha256)) {
      throw new Error(`${identity} override has invalid SHA-256.`);
    }

    const commitMatch = COMMIT_URL_PATTERN.exec(override.sourceCommitUrl);
    if (
      !commitMatch ||
      `${commitMatch[1]}/${commitMatch[2]}` !== override.sourceRepository
    ) {
      throw new Error(`${identity} override has invalid source commit URL.`);
    }
    const sourceCommit = commitMatch[3];
    const expectedLicensePrefix =
      `https://raw.githubusercontent.com/${override.sourceRepository}/` +
      `${sourceCommit}/`;
    if (
      !override.sourceLicenseUrl.startsWith(expectedLicensePrefix) ||
      override.sourceLicenseUrl === expectedLicensePrefix
    ) {
      throw new Error(`${identity} override has invalid source license URL.`);
    }
    const expectedMetadataUrl =
      `https://www.npmjs.com/package/${override.name}/v/${override.version}`;
    if (override.packageMetadataUrl !== expectedMetadataUrl) {
      throw new Error(`${identity} override has invalid package metadata URL.`);
    }

    const licensePath = path.join(overrideDirectory, override.licenseFile);
    const content = await readFile(licensePath);
    const actualSha256 = createHash("sha256").update(content).digest("hex");
    if (actualSha256 !== override.sha256) {
      throw new Error(
        `${identity} override license SHA-256 mismatch: expected ${override.sha256}, got ${actualSha256}.`,
      );
    }
    if (content.includes(0)) {
      throw new Error(`${identity} override license contains binary data.`);
    }

    overrides.set(identity, {
      ...override,
      content: normalizeAttributionText(content.toString("utf8")),
    });
  }

  return overrides;
}

async function discoverWorkspaces(rootDirectory) {
  const packagesDirectory = path.join(rootDirectory, "packages");
  const entries = await readdir(packagesDirectory, { withFileTypes: true });
  const workspaces = new Map();

  for (const entry of entries
    .filter((candidate) => candidate.isDirectory())
    .sort((left, right) => compareCodeUnits(left.name, right.name))) {
    const manifestPath = path.join(
      packagesDirectory,
      entry.name,
      "package.json",
    );
    if (!(await pathExists(manifestPath))) {
      continue;
    }
    const manifest = await readManifest(manifestPath);
    if (!manifest.name) {
      throw new Error(`${path.relative(rootDirectory, manifestPath)} has no name.`);
    }
    workspaces.set(manifest.name, { manifest, manifestPath });
  }

  return workspaces;
}

function enqueueRuntimeDependencies(queue, manifest, manifestPath, chain) {
  for (const [name, spec] of dependencyEntries(manifest, "required")) {
    queue.push({
      chain: [...chain, name],
      fromManifestPath: manifestPath,
      kind: "required",
      name,
      spec,
    });
  }
  for (const [name, spec] of dependencyEntries(manifest, "peer")) {
    if (manifest.peerDependenciesMeta?.[name]?.optional !== true) {
      queue.push({
        chain: [...chain, name],
        fromManifestPath: manifestPath,
        kind: "peer",
        name,
        spec,
      });
    }
  }
  for (const [name, spec] of dependencyEntries(manifest, "optional")) {
    queue.push({
      chain: [...chain, name],
      fromManifestPath: manifestPath,
      kind: "optional",
      name,
      spec,
    });
  }
}

function queueComparator(left, right) {
  return (
    compareCodeUnits(left.chain.join(" -> "), right.chain.join(" -> ")) ||
    compareCodeUnits(left.kind, right.kind)
  );
}

export async function collectDependencyClosure({
  rootDirectory = process.cwd(),
  platform = process.platform,
  architecture = process.arch,
} = {}) {
  const root = await realpath(rootDirectory);
  const workspaces = await discoverWorkspaces(root);
  const licenseOverrides = await readLicenseOverrides(root);
  const queue = [];

  for (const [name, { manifest, manifestPath }] of [...workspaces].sort(
    ([left], [right]) => compareCodeUnits(left, right),
  )) {
    enqueueRuntimeDependencies(queue, manifest, manifestPath, [name]);
  }

  const visitedRealpaths = new Set();
  const packagesByIdentity = new Map();
  const optionalExclusions = [];
  const problems = [];
  const usedLicenseOverrides = new Set();

  while (queue.length > 0) {
    queue.sort(queueComparator);
    const dependency = queue.shift();
    const workspace = workspaces.get(dependency.name);

    if (workspace && dependency.spec.startsWith("workspace:")) {
      continue;
    }

    const manifestPath = await findInstalledManifest(
      dependency.name,
      dependency.fromManifestPath,
      root,
    );
    if (!manifestPath) {
      if (dependency.kind === "optional") {
        optionalExclusions.push({
          architecture,
          chain: dependency.chain,
          name: dependency.name,
          platform,
          reason: "declared optional dependency is not installed",
        });
        continue;
      }
      problems.push(
        `Missing ${dependency.kind} dependency "${dependency.name}" required by ${dependency.chain.slice(0, -1).join(" -> ")}.`,
      );
      continue;
    }

    const packageDirectory = await realpath(path.dirname(manifestPath));
    const manifest = await readManifest(manifestPath);
    const identity = `${manifest.name}@${manifest.version}`;
    let record = packagesByIdentity.get(identity);

    if (!record) {
      let attributionFiles = await readAttributionFiles(packageDirectory);
      if (!attributionFiles.some((file) => file.kind === "license")) {
        const override = licenseOverrides.get(identity);
        if (override) {
          usedLicenseOverrides.add(identity);
          attributionFiles = [
            ...attributionFiles,
            {
              content: override.content,
              file: override.licenseFile,
              kind: "license",
              source: {
                commitUrl: override.sourceCommitUrl,
                licenseUrl: override.sourceLicenseUrl,
                packageMetadataUrl: override.packageMetadataUrl,
                sha256: override.sha256,
              },
            },
          ];
          if (manifest.license !== override.spdx) {
            problems.push(
              `${identity} declares "${manifest.license}" but its reviewed override is "${override.spdx}".`,
            );
          }
        }
      }
      record = {
        aliases: new Set(),
        attributionFiles,
        identity,
        license: manifest.license,
        name: manifest.name,
        provenance: new Set(),
        version: manifest.version,
      };
      packagesByIdentity.set(identity, record);

      if (
        typeof manifest.name !== "string" ||
        manifest.name.length === 0 ||
        typeof manifest.version !== "string" ||
        manifest.version.length === 0
      ) {
        problems.push(
          `${dependency.name} has incomplete installed package identity metadata.`,
        );
      }
      if (typeof manifest.license !== "string") {
        problems.push(`${identity} has no single SPDX license identifier.`);
      } else if (!ALLOWED_LICENSES.has(manifest.license)) {
        problems.push(`${identity} uses unapproved license "${manifest.license}".`);
      }
      if (!attributionFiles.some((file) => file.kind === "license")) {
        problems.push(`${identity} ships no license or copying text.`);
      }
    }

    record.provenance.add(dependency.chain.join(" -> "));
    if (
      dependency.name !== manifest.name ||
      dependency.spec.startsWith("npm:")
    ) {
      record.aliases.add(
        `${dependency.name} (${dependency.spec})`,
      );
    }

    if (visitedRealpaths.has(packageDirectory)) {
      continue;
    }
    visitedRealpaths.add(packageDirectory);
    enqueueRuntimeDependencies(
      queue,
      manifest,
      manifestPath,
      dependency.chain,
    );
  }

  for (const identity of licenseOverrides.keys()) {
    if (!usedLicenseOverrides.has(identity)) {
      problems.push(
        `${identity} license override is unused; remove it or verify the installed package version.`,
      );
    }
  }

  return {
    architecture,
    dependencies: [...packagesByIdentity.values()].sort((left, right) =>
      compareCodeUnits(left.identity, right.identity),
    ),
    optionalExclusions: optionalExclusions.sort((left, right) =>
      compareCodeUnits(
        `${left.name}:${left.chain.join(" -> ")}`,
        `${right.name}:${right.chain.join(" -> ")}`,
      ),
    ),
    platform,
    problems: problems.sort(compareCodeUnits),
  };
}

function assertValidClosure(closure) {
  if (closure.problems.length > 0) {
    throw new Error(
      `Dependency notice validation failed:\n- ${closure.problems.join("\n- ")}`,
    );
  }
}

function appendText(lines, content) {
  lines.push(content);
  if (!content.endsWith("\n")) {
    lines.push("\n");
  }
}

export function renderThirdPartyNotices(closure) {
  assertValidClosure(closure);
  const lines = [
    "THIRD-PARTY SOFTWARE NOTICES AND INFORMATION\n",
    "\n",
    "This file is generated by scripts/dependency-notices.mjs.\n",
    `Shipped dependency count: ${closure.dependencies.length}\n`,
    "\n",
  ];

  if (closure.optionalExclusions.length > 0) {
    lines.push(
      `Optional dependencies not installed for ${closure.platform}/${closure.architecture}:\n`,
    );
    for (const exclusion of closure.optionalExclusions) {
      lines.push(
        `- ${exclusion.name}: ${exclusion.reason}; declared by ${exclusion.chain.slice(0, -1).join(" -> ")}\n`,
      );
    }
    lines.push("\n");
  }

  for (const dependency of closure.dependencies) {
    lines.push(
      "================================================================================\n",
      `${dependency.identity}\n`,
      `License: ${dependency.license}\n`,
    );
    if (dependency.aliases.size > 0) {
      lines.push(
        `Installed aliases: ${[...dependency.aliases].sort(compareCodeUnits).join(", ")}\n`,
      );
    }
    lines.push("Required by:\n");
    for (const provenance of [...dependency.provenance].sort(compareCodeUnits)) {
      lines.push(`- ${provenance}\n`);
    }
    lines.push("\n");

    for (const attribution of dependency.attributionFiles) {
      if (attribution.source) {
        lines.push(
          `Reviewed package metadata: ${attribution.source.packageMetadataUrl}\n`,
          `Verified source commit: ${attribution.source.commitUrl}\n`,
          `Verified source license: ${attribution.source.licenseUrl}\n`,
          `Vendored license SHA-256: ${attribution.source.sha256}\n`,
        );
      }
      lines.push(`----- BEGIN ${attribution.file} -----\n`);
      appendText(lines, attribution.content);
      lines.push(`----- END ${attribution.file} -----\n\n`);
    }
  }

  return lines.join("").replace(/\n+$/, "\n");
}

export async function writeThirdPartyNotices({
  rootDirectory = process.cwd(),
  outputPath = path.join(rootDirectory, "THIRD_PARTY_NOTICES.txt"),
  ...options
} = {}) {
  const closure = await collectDependencyClosure({ rootDirectory, ...options });
  const rendered = renderThirdPartyNotices(closure);
  await writeFile(outputPath, rendered);
  return closure;
}

export async function checkThirdPartyNotices({
  rootDirectory = process.cwd(),
  outputPath = path.join(rootDirectory, "THIRD_PARTY_NOTICES.txt"),
  ...options
} = {}) {
  const closure = await collectDependencyClosure({ rootDirectory, ...options });
  const expected = renderThirdPartyNotices(closure);
  const actual = await readFile(outputPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      throw new Error(
        `${path.relative(rootDirectory, outputPath)} is missing. Run with --write.`,
      );
    }
    throw error;
  });
  if (actual !== expected) {
    throw new Error(
      `${path.relative(rootDirectory, outputPath)} is stale. Run with --write.`,
    );
  }
  return closure;
}

export function composeSiteThirdPartyNotices({
  dependencyNotices,
  archifyLicense,
  archifyNotices,
  fontLicense,
}) {
  return [
    dependencyNotices.trimEnd(),
    "\n\n================================================================================\n",
    "Embedded Archify viewer\n",
    "License: MIT\n\n",
    archifyLicense.trimEnd(),
    "\n\n",
    archifyNotices.trimEnd(),
    "\n\n================================================================================\n",
    "Embedded JetBrains Mono font subsets\n",
    "License: SIL OFL 1.1\n\n",
    fontLicense.trimEnd(),
    "\n",
  ].join("");
}

export async function copyThirdPartyNoticesToSite({
  rootDirectory = process.cwd(),
} = {}) {
  const sourcePath = path.join(rootDirectory, "THIRD_PARTY_NOTICES.txt");
  const closure = await checkThirdPartyNotices({
    rootDirectory,
    outputPath: sourcePath,
  });
  const siteDirectory = path.join(rootDirectory, "packages", "site", "dist");
  if (!(await pathExists(siteDirectory))) {
    throw new Error(
      `${path.relative(rootDirectory, siteDirectory)} is missing; build the site before --site.`,
    );
  }
  const archifyDirectory = path.join(
    rootDirectory,
    "packages",
    "diagram-core",
    "vendor",
    "archify",
  );
  const archifyLicense = await readFile(
    path.join(archifyDirectory, "LICENSE"),
    "utf8",
  );
  const archifyNotices = await readFile(
    path.join(archifyDirectory, "THIRD_PARTY_NOTICES.md"),
    "utf8",
  );
  const bundledLicenses = path.join(
    rootDirectory,
    "experiments",
    "archify-wrapper",
    "licenses",
  );
  const fontLicense = await readFile(
    path.join(bundledLicenses, "JetBrainsMono-OFL.txt"),
    "utf8",
  );
  const dependencyNotices = await readFile(sourcePath, "utf8");
  await writeFile(
    path.join(siteDirectory, "THIRD_PARTY_NOTICES.txt"),
    composeSiteThirdPartyNotices({
      dependencyNotices,
      archifyLicense,
      archifyNotices,
      fontLicense,
    }),
  );
  await writeFile(
    path.join(siteDirectory, "ARCHIFY_LICENSE.txt"),
    archifyLicense,
  );
  await writeFile(
    path.join(siteDirectory, "JETBRAINS_MONO_LICENSE.txt"),
    fontLicense,
  );
  await copyFile(
    path.join(rootDirectory, "LICENSE"),
    path.join(siteDirectory, "LICENSE.txt"),
  );
  return closure;
}

async function main() {
  const modes = process.argv.slice(2).filter((argument) =>
    ["--write", "--check", "--site"].includes(argument),
  );
  if (modes.length !== 1 || process.argv.length !== 3) {
    throw new Error(
      "Usage: node scripts/dependency-notices.mjs --write|--check|--site",
    );
  }

  const mode = modes[0];
  const closure =
    mode === "--write"
      ? await writeThirdPartyNotices()
      : mode === "--check"
        ? await checkThirdPartyNotices()
        : await copyThirdPartyNoticesToSite();

  console.log(
    `Verified ${closure.dependencies.length} shipped dependencies (${closure.optionalExclusions.length} optional exclusions).`,
  );
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  await main();
}
