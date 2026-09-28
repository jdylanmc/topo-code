import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const jobs: unknown = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
if (!Array.isArray(jobs)) throw new Error("Invalid Archify batch manifest");
const renderer = fileURLToPath(new URL(
  "../vendor/archify/renderers/architecture/render-architecture.mjs",
  import.meta.url,
));
const checker = fileURLToPath(new URL(
  "../vendor/archify/scripts/check-render-output.mjs",
  import.meta.url,
));

// Each native CLI entrypoint gets a fresh module evaluation; its shared libraries
// stay loaded in this isolated child instead of starting two processes per view.
for (const [index, job] of jobs.entries()) {
  if (
    typeof job !== "object" || job === null ||
    typeof job.input !== "string" || typeof job.output !== "string" ||
    typeof job.repository !== "string"
  ) throw new Error(`Invalid Archify batch job ${index}`);
  process.env.ARCHIFY_REPO_ROOT = job.repository;
  process.env.ARCHIFY_QUALITY_PROFILE = "standard";
  process.argv = [process.execPath, renderer, job.input, job.output];
  await import(`${pathToFileURL(renderer).href}?batch=${index}`);
  process.argv = [process.execPath, checker, job.output];
  await import(`${pathToFileURL(checker).href}?batch=${index}`);
  if (Number(process.exitCode ?? 0) !== 0) {
    throw new Error(`Archify output validation failed for ${job.input}`);
  }
}
