import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const execute = promisify(execFile);

export async function repository(context, files) {
  const root = await mkdtemp(join(tmpdir(), "topo-language-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  const env = {
    ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  };
  await execute("git", ["init", "-q", "-b", "main", root], { env });
  await execute("git", ["-C", root, "add", "."], { env });
  await execute("git", ["-C", root, "-c", "core.hooksPath=/dev/null",
    "-c", "user.name=Topocode synthetic fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "-qm", "fixture"], { env });
  return realpath(root);
}

export const MIXED_FILES = {
  "package.json": '{"name":"fixture","type":"module","dependencies":{"@tauri-apps/api":"2.10.1"}}\n',
  "src/main.ts": `import { invoke } from "@tauri-apps/api/core";
export async function refresh() { return invoke("snapshot"); }
`,
  "src-tauri/Cargo.toml": '[package]\nname="fixture"\nversion="0.1.0"\nedition="2021"\n',
  "src-tauri/src/lib.rs": `#[tauri::command]
pub fn snapshot() -> String { "fixture".to_owned() }
pub fn run() { tauri::Builder::default().invoke_handler(tauri::generate_handler![snapshot]); }
`,
};
