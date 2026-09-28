#!/usr/bin/env node
import { runCli, describeError } from "../node_modules/@topo/cli/dist/main.js";

if (Number(process.versions.node.split(".")[0]) < 22) {
  console.error("Topocode requires Node.js 22 or newer.");
  process.exitCode = 1;
} else {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`Topocode: ${describeError(error)}`);
    process.exitCode = 1;
  }
}
