import { describe, expect, it } from "vitest";
import { BUILTIN_MODULE_MANIFESTS } from "@topo/modules";
import { selectSiteModules } from "../module-build.js";

describe("compiled module selection", () => {
  it("defaults to the static catalog and supports explicitly omitting modules", () => {
    expect(selectSiteModules(undefined)).toEqual(BUILTIN_MODULE_MANIFESTS);
    expect(selectSiteModules("")).toEqual([]);
    expect(selectSiteModules("@topo/module-degree").map((entry) => entry.id)).toEqual(["@topo/module-degree"]);
    expect(selectSiteModules("@topo/module-cycles,@topo/module-degree"))
      .toEqual(selectSiteModules("@topo/module-degree,@topo/module-cycles"));
  });

  it.each(["unknown", "@topo/module-degree,", "@topo/module-degree,@topo/module-degree"])(
    "rejects unsupported build configuration: %s", (value) => {
      expect(() => selectSiteModules(value)).toThrow("TOPO_SITE_MODULES");
    },
  );
});
