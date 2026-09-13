import type { ModuleManifestEntry } from "@topo/schema";

export interface ModuleAttributeSchema {
  key: string;
  label: string;
  subjectKind: "node";
  schema: {
    type: "integer";
    minimum: 0;
  };
}

export interface ModuleViewRegistration {
  id: string;
  label: string;
  attributeKeys: readonly string[];
}

export interface StaticModuleManifest extends ModuleManifestEntry {
  label: string;
  dependencies: readonly string[];
  attributes: readonly ModuleAttributeSchema[];
  views: readonly ModuleViewRegistration[];
}
