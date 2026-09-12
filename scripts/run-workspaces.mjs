import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function discoverWorkspaces(packagesDirectory = path.resolve("packages")) {
  let packageDirectories = [];

  try {
    packageDirectories = await readdir(packagesDirectory, {
      withFileTypes: true,
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const workspaces = [];
  for (const directory of packageDirectories
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => compareCodeUnits(left.name, right.name))) {
    const manifestPath = path.join(
      packagesDirectory,
      directory.name,
      "package.json",
    );

    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      workspaces.push({ manifest, manifestPath });
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return workspaces;
}

function workspaceDependencyNames(manifest) {
  return new Set(
    Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    }),
  );
}

export function orderWorkspaces(workspaces) {
  const byName = new Map();

  for (const workspace of workspaces) {
    const { manifest, manifestPath } = workspace;
    if (!manifest.name) {
      throw new Error(`${manifestPath} must declare a package name.`);
    }
    if (byName.has(manifest.name)) {
      throw new Error(`Duplicate workspace name "${manifest.name}".`);
    }
    byName.set(manifest.name, workspace);
  }

  const dependencies = new Map(
    [...byName].map(([name, workspace]) => [
      name,
      new Set(
        [...workspaceDependencyNames(workspace.manifest)].filter((dependency) =>
          byName.has(dependency),
        ),
      ),
    ]),
  );
  const ordered = [];

  while (dependencies.size > 0) {
    const ready = [...dependencies]
      .filter(([, names]) => names.size === 0)
      .map(([name]) => name)
      .sort(compareCodeUnits);

    if (ready.length === 0) {
      throw new Error(
        `Workspace dependency cycle: ${[...dependencies.keys()].sort(compareCodeUnits).join(", ")}`,
      );
    }

    for (const name of ready) {
      ordered.push(byName.get(name));
      dependencies.delete(name);
    }
    for (const names of dependencies.values()) {
      for (const name of ready) {
        names.delete(name);
      }
    }
  }

  return ordered;
}

export function runYarnWorkspace(
  yarnPath,
  workspaceName,
  script,
  spawn = spawnSync,
) {
  const result = spawn(
    yarnPath,
    ["workspace", workspaceName, "run", script],
    {
      shell: false,
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

export async function runWorkspaceScripts({
  script,
  packagesDirectory,
  yarnPath,
  runWorkspace = runYarnWorkspace,
}) {
  if (!script) {
    throw new Error("Usage: node scripts/run-workspaces.mjs <script>");
  }

  const workspaces = orderWorkspaces(
    await discoverWorkspaces(packagesDirectory),
  );

  if (workspaces.length === 0) {
    console.log(`No package workspaces have landed; skipping "${script}".`);
    return 0;
  }

  for (const { manifest } of workspaces) {
    if (!manifest.scripts?.[script]) {
      throw new Error(`${manifest.name} must declare the "${script}" script.`);
    }
  }

  if (!yarnPath) {
    throw new Error(`Run workspace scripts through Yarn: yarn ${script}`);
  }

  for (const { manifest } of workspaces) {
    const status = runWorkspace(yarnPath, manifest.name, script);
    if (status !== 0) {
      return status;
    }
  }

  return 0;
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const status = await runWorkspaceScripts({
    script: process.argv[2],
    packagesDirectory: path.resolve("packages"),
    yarnPath: process.env.npm_execpath,
  });
  process.exit(status);
}
