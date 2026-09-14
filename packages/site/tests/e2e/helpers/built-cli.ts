type CliIndex = Pick<
  typeof import("../../../../cli/src/index.js"),
  "generateArtifacts" | "serveSite"
>;
type CliServer = Pick<
  typeof import("../../../../cli/src/server.js"),
  "serveSite"
>;

const cliIndexPath = "../../../../cli/dist/index.js";
const cliServerPath = "../../../../cli/dist/server.js";

export function loadBuiltCliIndex(): Promise<CliIndex> {
  return import(cliIndexPath);
}

export function loadBuiltCliServer(): Promise<CliServer> {
  return import(cliServerPath);
}
