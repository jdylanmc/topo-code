import { parse, registerDynamicLanguage } from "@ast-grep/napi";
import rust from "@ast-grep/lang-rust";
import toml from "@iarna/toml";
import { posix } from "node:path";
import { compare, emptyContribution, factId, hash, repositoryPath, sourceLocation } from "../contract.mjs";

// The napi package bundles web grammars only. This loads the separate prebuilt
// Rust grammar; neither the grammar's postinstall nor a compiler is invoked.
registerDynamicLanguage({ rust });

export const manifest = Object.freeze({
  id: "rust",
  version: "1.0",
  kind: "language",
  languages: ["rust"],
  capabilities: ["syntax-declarations", "lexical-ownership", "lexical-binding-observations", "local-impl-targets", "cargo-manifest-evidence", "tauri-syntax-observations"],
});

const KINDS = new Map([
  ["struct_item", "struct"], ["enum_item", "enum"], ["union_item", "union"],
  ["trait_item", "trait"], ["impl_item", "impl"], ["mod_item", "module"],
  ["function_item", "function"], ["function_signature_item", "function"],
  ["type_item", "type"], ["associated_type", "type"], ["const_item", "const"],
  ["static_item", "static"], ["enum_variant", "variant"], ["field_declaration", "field"],
  ["macro_definition", "macro"], ["foreign_mod_item", "extern-block"],
  ["extern_crate_declaration", "extern-crate"],
]);
const COMMENT_KINDS = new Set(["line_comment", "block_comment"]);
const ATTRIBUTE_KINDS = new Set(["attribute_item", "inner_attribute_item"]);
const LIMITATIONS = [
  "Tree-sitter syntax evidence, not Rust compiler validation or whole-program semantics.",
  "cfg and cfg_attr are recorded but never evaluated; all observed branches remain present.",
  "Macros (including derive, attribute/procedural macros and include!) are not expanded.",
  "Calls and use declarations remain unresolved; spelling is not semantic name resolution.",
  "Impl endpoint edges are limited to unique, direct, nongeneric names in the same lexical scope.",
  "Cargo TOML records declared configuration only; no Cargo metadata, dependency resolution, build scripts or compiler execution.",
  "Base qualified names remain source-relative lexical names. Extension Rust paths follow only captured Cargo lib/bin roots and explicit default-layout module declarations; custom path/cfg_attr routing and aliases are not resolved.",
  "Named item/field declarations are extracted; local bindings are syntax-only extension observations, not entities or resolved names. Tuple-field positions and generic parameter entities are not inventoried.",
  "Lexical binding candidates do not resolve Rust namespaces or identifier-versus-constant patterns. Unsupported patterns, conditional binding scopes and opaque statement/item macros are explicit wildcard blockers.",
  "Visibility records syntax only; inherited means no explicit modifier, not necessarily private. exported means explicit unrestricted pub, not effective API visibility.",
  "The pinned Rust grammar does not fully support modern unsafe extern blocks; parser recovery is flagged rather than repaired or normalized.",
  "Tauri observations are syntactic declarations/registration tokens, not macro validity, plugin installation or runtime reachability.",
  "Ranges are 1-based UTF-16 code-unit columns with exclusive ends, matching the pinned napi binding's observed offsets.",
];

function cleanName(text) {
  return text.startsWith("r#") ? text.slice(2) : text;
}

function location(file, node) {
  const { start, end } = node.range();
  return sourceLocation(file.path, start.line + 1, end.line + 1, start.column + 1, end.column + 1);
}

function tokens(node) {
  return node.children().filter((child) => !COMMENT_KINDS.has(child.kind()));
}

function commaGroups(tree) {
  const result = [[]];
  for (const token of tokens(tree).slice(1, -1)) {
    if (token.kind() === ",") result.push([]);
    else result.at(-1).push(token);
  }
  return result.filter((group) => group.length);
}

function stringValue(node) {
  if (node.kind() === "raw_string_literal") {
    const text = node.text();
    return text.slice(text.indexOf('"') + 1, text.lastIndexOf('"'));
  }
  if (node.kind() !== "string_literal") return null;
  const text = node.text().slice(1, -1);
  let result = "";
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== "\\") {
      result += text[index];
      continue;
    }
    const escape = text[++index];
    const simple = { n: "\n", r: "\r", t: "\t", "0": "\0", "\\": "\\", '"': '"', "'": "'" };
    if (Object.hasOwn(simple, escape)) result += simple[escape];
    else if (escape === "x" && /^[0-7][0-9a-f]$/i.test(text.slice(index + 1, index + 3))) {
      result += String.fromCharCode(Number.parseInt(text.slice(index + 1, index + 3), 16));
      index += 2;
    } else if (escape === "u") {
      const match = /^\{([0-9a-f_]{1,8})\}/i.exec(text.slice(index + 1));
      const value = match ? Number.parseInt(match[1].replaceAll("_", ""), 16) : NaN;
      if (!Number.isInteger(value) || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return null;
      result += String.fromCodePoint(value);
      index += match[0].length;
    } else if (escape === "\n" || (escape === "\r" && text[index + 1] === "\n")) {
      if (escape === "\r") index++;
      while (/\s/.test(text[index + 1] ?? "") && index + 1 < text.length) index++;
    } else return null;
  }
  return result;
}

function attributeInfo(node) {
  const attribute = node.namedChildren().find((child) => child.kind() === "attribute");
  const path = attribute?.namedChildren().find((child) => child.kind() !== "token_tree")?.text() ?? "";
  return { path, text: node.text(), args: attribute?.field("arguments") ?? null, node };
}

function conditionsFor(attributes) {
  return attributes.filter((attribute) => attribute.path === "cfg" || attribute.path === "cfg_attr")
    .map((attribute) => attribute.text);
}

function unique(values) {
  return [...new Set(values)];
}

function signature(node) {
  const body = node.field("body");
  return body ? node.text().slice(0, body.range().start.index - node.range().start.index).trimEnd() : node.text();
}

function handlerPaths(tree) {
  const paths = [];
  const rejected = [];
  for (const group of commaGroups(tree)) {
    let expectName = true;
    let valid = true;
    const parts = [];
    for (const token of group) {
      if (token.kind() === "::" && (parts.length === 0 || !expectName)) {
        parts.push("::");
        expectName = true;
      } else if (expectName && ["identifier", "crate", "self", "super"].includes(token.kind())) {
        parts.push(token.text());
        expectName = false;
      } else valid = false;
    }
    if (valid && !expectName) paths.push(parts.join(""));
    else rejected.push(group.map((token) => token.text()).join(" "));
  }
  return { paths, rejected };
}

function registrationContext(node) {
  const args = node.parent();
  const call = args?.parent();
  const fn = call?.kind() === "call_expression" ? call.field("function") : null;
  if (args?.kind() !== "arguments" || fn?.kind() !== "field_expression" ||
      fn.field("field")?.text() !== "invoke_handler") return { registrationKind: "unknown" };
  let receiver = fn.field("value");
  while (receiver?.kind() === "call_expression") {
    const callee = receiver.field("function");
    if (callee?.kind() === "field_expression") receiver = callee.field("value");
    else {
      const rootCallee = callee?.text() ?? "";
      if (rootCallee === "tauri::Builder::default" || rootCallee === "tauri::Builder::new") {
        return { registrationKind: "app-builder", receiverRoot: rootCallee };
      }
      if (rootCallee === "tauri::plugin::Builder::new") {
        const argumentsNode = receiver.field("arguments");
        const firstArgument = argumentsNode?.namedChildren().find((child) => !COMMENT_KINDS.has(child.kind()));
        const pluginNamespace = firstArgument ? stringValue(firstArgument) : null;
        return {
          registrationKind: "plugin-builder", receiverRoot: rootCallee,
          pluginNamespaceStatus: pluginNamespace === null ? "unresolved" : "literal",
          ...(pluginNamespace === null ? {} : { pluginNamespace }),
        };
      }
      return { registrationKind: "unknown", receiverRoot: rootCallee };
    }
  }
  return { registrationKind: "unknown" };
}

function cargoRecords(file, inventory, contribution) {
  let parsed;
  try {
    parsed = toml.parse(file.contents);
  } catch (error) {
    contribution.diagnostics.push({ code: "rust.invalid-cargo-manifest", severity: "error", path: file.path, message: error.message });
    return { manifestPath: file.path, sha256: file.sha256, status: "invalid", evidenceKind: "declared-manifest-only" };
  }
  const table = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const tableKeys = ["package", "workspace", "lib", "dependencies", "dev-dependencies", "build-dependencies", "target", "features"];
  const invalid = tableKeys.some((key) => parsed[key] !== undefined && !table(parsed[key])) ||
    ["bin", "example", "test", "bench"].some((key) => parsed[key] !== undefined && (!Array.isArray(parsed[key]) || !parsed[key].every(table))) ||
    Object.values(parsed.target ?? {}).some((value) => !table(value) ||
      ["dependencies", "dev-dependencies", "build-dependencies"].some((key) => value[key] !== undefined && !table(value[key])));
  if (invalid) {
    contribution.diagnostics.push({ code: "rust.invalid-cargo-shape", severity: "error", path: file.path, message: "Cargo manifest tables/target lists have unsupported shapes; no package or dependency facts inferred." });
    return { manifestPath: file.path, sha256: file.sha256, status: "invalid", evidenceKind: "declared-manifest-only" };
  }
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const dependencies = [];
  function addDependencies(table, target = null) {
    for (const kind of ["dependencies", "dev-dependencies", "build-dependencies"]) {
      for (const [name, specification] of Object.entries(table?.[kind] ?? {}).sort(([a], [b]) => compare(a, b))) {
        dependencies.push({ name, kind, target, specification: plain(specification) });
      }
    }
  }
  addDependencies(parsed);
  for (const [target, table] of Object.entries(parsed.target ?? {}).sort(([a], [b]) => compare(a, b))) addDependencies(table, target);
  const directory = posix.dirname(file.path);
  const targets = [];
  function target(kind, value, origin) {
    const record = { kind, declaration: plain(value), origin };
    if (typeof value.path === "string") {
      const candidate = posix.normalize(posix.join(directory, value.path));
      try {
        repositoryPath(candidate);
        record.sourcePath = candidate;
        record.sourcePresent = inventory.has(candidate);
      } catch {
        contribution.diagnostics.push({ code: "rust.cargo-target-outside-inventory", severity: "warning", path: file.path, message: `Target path is outside the repository-relative inventory: ${value.path}` });
      }
    }
    targets.push(record);
  }
  if (parsed.lib) target("lib", parsed.lib, "manifest");
  for (const kind of ["bin", "example", "test", "bench"]) {
    if (Array.isArray(parsed[kind])) for (const value of parsed[kind]) target(kind, value, "manifest");
  }
  for (const [kind, path] of [["lib", "src/lib.rs"], ["bin", "src/main.rs"], ["build-script", "build.rs"]]) {
    const candidate = posix.join(directory === "." ? "" : directory, path);
    if (inventory.has(candidate)) target(kind, { path }, "conventional-source-candidate-not-resolved-target");
  }
  if (!parsed.package && !parsed.workspace) {
    contribution.diagnostics.push({ code: "rust.manifest-without-package-or-workspace", severity: "warning", path: file.path, message: "TOML parsed, but neither [package] nor [workspace] is present." });
  }
  const moduleRoots = [];
  function moduleRoot(kind, path, declaredName, rootEvidence, requiredFeatures = []) {
    const invalidRoot = () => contribution.diagnostics.push({
      code: "rust.unresolved-cargo-root", severity: "warning", path: file.path,
      message: `Cannot establish a contained ${kind} source root from this declared path: ${JSON.stringify(path)}`,
    });
    if (typeof path !== "string" || path.startsWith("/") || path.includes("\\")) {
      invalidRoot();
      return;
    }
    const sourcePath = posix.normalize(posix.join(directory, path));
    try {
      repositoryPath(sourcePath);
    } catch {
      invalidRoot();
      return;
    }
    if (!sourcePath.endsWith(".rs") || !inventory.has(sourcePath)) return;
    const crateId = factId("rust", "crate-root", file.path, JSON.stringify([kind, sourcePath, declaredName]));
    if (!moduleRoots.some((root) => root.crateId === crateId)) {
      moduleRoots.push({ crateId, kind, sourcePath, manifestPath: file.path, declaredName, rootEvidence, requiredFeatures });
    }
  }
  if (typeof parsed.package?.name === "string") {
    const packageName = parsed.package.name.replaceAll("-", "_");
    if (parsed.lib || parsed.package.autolib !== false) {
      moduleRoot("lib", parsed.lib?.path ?? "src/lib.rs", parsed.lib?.name ?? packageName,
        parsed.lib?.path ? "explicit-lib-path" : "cargo-default-lib-source");
    }
    for (const bin of parsed.bin ?? []) {
      if (typeof bin.path === "string") {
        moduleRoot("bin", bin.path, bin.name ?? packageName, "explicit-bin-path", plain(bin["required-features"] ?? []));
      }
    }
    const mainSource = posix.join(directory, "src/main.rs");
    if (parsed.package.autobins !== false && !moduleRoots.some((root) => root.kind === "bin" && root.sourcePath === mainSource)) {
      moduleRoot("bin", "src/main.rs", packageName, "cargo-default-bin-source");
    }
  }
  return {
    id: factId("rust", "manifest", file.path, "cargo"),
    manifestPath: file.path,
    sha256: file.sha256,
    status: "parsed",
    evidenceKind: "declared-manifest-only", cargoSchemaValidated: false,
    package: parsed.package ? plain(parsed.package) : null,
    workspace: parsed.workspace ? plain(parsed.workspace) : null,
    dependencies,
    features: plain(parsed.features ?? {}),
    targets,
    moduleRoots,
  };
}

/** @param {import("../contract-types.js").ScanContext} context
 * @returns {Promise<import("../contract-types.js").Contribution>} */
export async function scanRust(context) {
  const contribution = emptyContribution(manifest.id, manifest.kind, manifest.languages, manifest.capabilities);
  const inventory = new Map();
  for (const file of context.files) {
    repositoryPath(file.path);
    if (inventory.has(file.path)) throw new Error(`Duplicate captured inventory path: ${file.path}`);
    if (typeof file.contents !== "string" || hash(file.contents) !== file.sha256) {
      throw new Error(`Captured inventory sha256 mismatch: ${file.path}`);
    }
    inventory.set(file.path, file);
  }
  const files = [...inventory.values()].sort((a, b) => compare(a.path, b.path));
  const rustFiles = files.filter((file) => file.path.endsWith(".rs"));
  const manifests = files.filter((file) => posix.basename(file.path) === "Cargo.toml");
  const metadata = [];
  const declarations = [];
  const impls = [];
  const registrationRecords = new Map();
  const identities = new Map();
  const unresolvedIds = new Set();
  const scopesByName = new Map();
  const bindingIds = new Set();
  const extensions = {
    parser: { binding: "@ast-grep/napi", version: "0.45.3", grammar: "@ast-grep/lang-rust", grammarVersion: "0.0.7", backend: "tree-sitter", rangeEncoding: "utf-16", endExclusive: true },
    crates: manifests.map((file) => cargoRecords(file, inventory, contribution)),
    entityMetadata: metadata,
    attributeObservations: [],
    files: [],
    tauriCommands: [],
    tauriRegistrations: [],
    moduleMappings: [],
    lexicalScopes: [],
    lexicalBindings: [],
    useDeclarations: [],
    analysisPolicy: { builds: false, cargo: false, compiler: false, procMacros: false, macroExpansion: false, cfgEvaluation: false, callsResolved: false },
  };
  contribution.extensions = extensions;
  contribution.coverage.limitations = [...LIMITATIONS];
  contribution.coverage.analyzedFiles = [...manifests, ...rustFiles].map((file) => file.path).sort(compare);
  if (!rustFiles.length && !manifests.length) contribution.coverage.status = "unsupported";

  function unresolved(file, node, kind, text, reason, ownerId, candidates) {
    const loc = location(file, node);
    const id = factId("rust", `unresolved-${kind}`, file.path, JSON.stringify([node.range().start.index, node.range().end.index, text]));
    if (unresolvedIds.has(id)) return;
    unresolvedIds.add(id);
    contribution.unresolved.push({ id, kind, text, reason, location: loc, ...(ownerId ? { ownerId } : {}), ...(candidates ? { candidates } : {}) });
  }
  function edge(from, to, kind, evidence, method = "syntax-explicit-lexical") {
    contribution.relationships.push({
      id: factId("rust", kind, evidence.path, JSON.stringify([from, to, evidence])),
      from, to, kind, method, evidence: [evidence],
    });
  }

  for (const file of rustFiles) {
    const metadataStart = metadata.length;
    const root = parse("rust", file.contents).root();
    const manifestFile = manifests.filter((candidate) => {
      const directory = posix.dirname(candidate.path);
      return directory === "." || file.path.startsWith(`${directory}/`);
    }).sort((a, b) => b.path.length - a.path.length)[0];
    const fileRecord = {
      path: file.path, sha256: file.sha256, status: "parsed", syntaxErrors: 0,
      nearestManifestPath: manifestFile?.path ?? null,
      manifestAssociation: "directory-containment-only",
    };
    extensions.files.push(fileRecord);
    if (!manifestFile) contribution.diagnostics.push({ code: "rust.missing-cargo-manifest", severity: "warning", path: file.path, message: "No enclosing Cargo.toml in captured inventory; syntax extraction continues without crate ownership." });
    const diagnosticCodes = new Set();
    function warnOnce(code, message) {
      if (diagnosticCodes.has(code)) return;
      diagnosticCodes.add(code);
      contribution.diagnostics.push({ code, severity: "warning", path: file.path, message });
    }
    function lexicalScope(scope, parentScope, kind, node, ownerId) {
      const loc = location(file, node);
      const existing = scopesByName.get(scope);
      if (existing) {
        if (JSON.stringify(existing.location) !== JSON.stringify(loc)) {
          existing.status = "ambiguous";
          existing.alternateLocations ??= [];
          existing.alternateLocations.push(loc);
          unsupportedBinding(node, { scope, owner: ownerId ? { id: ownerId } : null, conditions: [] },
            "ambiguous-scope", "Multiple declarations share this lexical scope identity; no unique scope is inferred.");
        }
        return;
      }
      const record = {
        lexicalScope: scope, parentScope, kind, location: loc, status: "established",
        ...(ownerId ? { ownerId } : {}),
      };
      scopesByName.set(scope, record);
      extensions.lexicalScopes.push(record);
    }
    function scopedName(scope, kind, node) {
      const { start } = node.range();
      return `${scope}::<${kind}@${start.line + 1}:${start.column + 1}>`;
    }
    function binding(node, state, kind, name, options = {}) {
      const id = factId("rust", "lexical-binding", file.path,
        JSON.stringify([state.scope, kind, name, node.range().start.index, node.range().end.index, options.entityId ?? null]));
      if (bindingIds.has(id)) return;
      bindingIds.add(id);
      extensions.lexicalBindings.push({
        id, ...(name === null ? { wildcard: true } : { name: cleanName(name) }),
        kind, lexicalScope: state.scope, location: location(file, node), text: node.text(),
        availability: "whole-scope", bindingStatus: "syntactic-candidate",
        ...(state.owner?.id ? { ownerId: state.owner.id } : {}),
        ...(state.conditions?.length ? { conditions: state.conditions } : {}),
        ...options,
      });
    }
    function unsupportedBinding(node, state, kind, reason, options = {}) {
      binding(node, state, kind, null, { ...options, bindingStatus: "unsupported", reason });
      warnOnce("rust.lexical-bindings-partial", "Unsupported binding syntax/scopes and opaque macros are explicit wildcard observations; lexical absence is not semantic resolution.");
      unresolved(file, node, "lexical-binding", node.text(), reason, state.owner?.id);
    }
    function bindPattern(node, state, kind, options = {}) {
      const syntax = node.kind();
      if (["identifier", "shorthand_field_identifier", "self"].includes(syntax)) {
        if (node.text() !== "_") binding(node, state, kind, node.text(), options);
      } else if (syntax === "field_pattern") {
        const pattern = node.field("pattern");
        const name = node.field("name");
        if (pattern) bindPattern(pattern, state, kind, options);
        else if (name?.kind() === "shorthand_field_identifier") bindPattern(name, state, kind, options);
        else unsupportedBinding(node, state, "unsupported-pattern", "Unsupported field-pattern binding.", options);
      } else if (["tuple_pattern", "tuple_struct_pattern", "struct_pattern", "slice_pattern", "ref_pattern",
        "mut_pattern", "reference_pattern", "captured_pattern", "match_pattern"].includes(syntax)) {
        const type = node.field("type");
        const condition = node.field("condition");
        for (const child of node.namedChildren()) {
          if (child.id() !== type?.id() && child.id() !== condition?.id()) bindPattern(child, state, kind, options);
        }
      } else if (node.text() === "_" || ["remaining_field_pattern", "mutable_specifier",
        "scoped_identifier", "type_identifier", "integer_literal", "float_literal", "boolean_literal",
        "string_literal", "raw_string_literal", "char_literal", "negative_literal", "range_pattern",
        "unit_expression"].includes(syntax) || COMMENT_KINDS.has(syntax)) {
        return;
      } else {
        unsupportedBinding(node, state, "unsupported-pattern", `Unsupported or ambiguous ${syntax} binding pattern; names are not guessed.`, options);
      }
    }
    function useLeaf(node) {
      if (!node) return null;
      if (node.kind() === "scoped_identifier") {
        const name = node.field("name");
        return name?.kind() === "self" ? useLeaf(node.field("path")) : useLeaf(name);
      }
      return ["identifier", "self", "super", "crate"].includes(node.kind()) ? node.text() : null;
    }
    function bindUse(node, state, prefixLeaf, useDeclarationId) {
      const syntax = node.kind();
      const options = { bindingStatus: "unresolved-import", useDeclarationId };
      const unsupported = (reason) => unsupportedBinding(node, state, "unsupported-use", reason, { useDeclarationId });
      if (syntax === "use_list") {
        for (const child of node.namedChildren()) if (!COMMENT_KINDS.has(child.kind())) bindUse(child, state, prefixLeaf, useDeclarationId);
      } else if (syntax === "scoped_use_list") {
        const path = node.field("path");
        const leaf = useLeaf(path);
        const list = node.namedChildren().find((child) => child.kind() === "use_list");
        if (list) bindUse(list, state, leaf === "self" ? prefixLeaf : leaf, useDeclarationId);
        else unsupported("Use-list structure is incomplete; introduced names are unknown.");
      } else if (syntax === "use_as_clause") {
        const alias = node.field("alias");
        if (alias?.kind() === "identifier") {
          if (alias.text() !== "_") binding(alias, state, "use-alias", alias.text(), options);
        } else unsupported("Use alias is not a parsed identifier.");
      } else if (syntax === "use_wildcard") {
        binding(node, state, "use-glob", null, { ...options, reason: "Glob-imported names are not resolved." });
      } else if (syntax === "self") {
        if (prefixLeaf) binding(node, state, "use-self", prefixLeaf, options);
        else unsupported("Self import has no established syntactic prefix name.");
      } else {
        const name = useLeaf(node);
        if (name && !["crate", "super", "self", "_"].includes(name)) binding(node, state, "use", name, options);
        else unsupported(`Unsupported ${syntax} use tree; introduced names are unknown.`);
      }
    }
    function recordAttributes(attributes, ownerId) {
      for (const attribute of attributes) {
        extensions.attributeObservations.push({
          path: attribute.path, text: attribute.text, location: location(file, attribute.node),
          attachment: attribute.node.kind() === "inner_attribute_item" ? "inner" : "outer",
          ...(ownerId ? { ownerId } : {}),
        });
        if (attribute.path === "cfg" || attribute.path === "cfg_attr") {
          warnOnce("rust.cfg-unevaluated", "cfg/cfg_attr conditions are preserved, not evaluated.");
          unresolved(file, attribute.node, "cfg", attribute.text, "Condition unevaluated; no active-branch claim.", ownerId);
        } else if (!["doc", "allow", "warn", "deny", "forbid", "test", "ignore", "inline", "cold", "must_use", "repr", "path", "no_mangle", "export_name", "link", "link_name"].includes(attribute.path)) {
          warnOnce("rust.attributes-unexpanded", "Nontrivial attributes, including derive and potential procedural macros, are not expanded or validated.");
          unresolved(file, attribute.node, "attribute", attribute.text, "Attribute syntax only; effect and macro expansion unknown.", ownerId);
        }
      }
    }
    function command(entity, attributes, conditions) {
      const commandAttributes = attributes.filter((attribute) => attribute.path === "tauri::command");
      if (commandAttributes.length > 1) {
        warnOnce("rust.ambiguous-tauri-command", "Multiple tauri::command attributes on one declaration; no unique command observation emitted.");
        return;
      }
      const attribute = commandAttributes[0];
      if (!attribute) return;
      let commandName = entity.name;
      let renameAll = null;
      let invalidRename = false;
      let seenRename = false;
      for (const group of attribute.args ? commaGroups(attribute.args) : []) {
        const option = group[0].text();
        if (option !== "rename" && option !== "rename_all") continue;
        const value = group.length === 3 && group[1].kind() === "=" ? stringValue(group[2]) : null;
        if (value === null || (option === "rename" && seenRename)) {
          invalidRename = true;
          unresolved(file, attribute.node, "tauri-command-options", attribute.text, "Unsupported or duplicate rename option; command name not inferred.", entity.id);
        } else if (option === "rename") {
          seenRename = true;
          commandName = value;
        } else renameAll = value;
      }
      if (!invalidRename) {
        extensions.tauriCommands.push({
          entityId: entity.id, commandName, location: entity.location, conditions,
          attributeLocation: location(file, attribute.node), argumentRenameAll: renameAll,
          evidenceKind: "unexpanded-command-attribute", runtimeReachability: "unknown",
        });
      }
    }
    function visitContainer(container, state) {
      const children = container.children();
      const inner = children.filter((node) => node.kind() === "inner_attribute_item").map(attributeInfo);
      recordAttributes(inner, state.owner?.id);
      const inherited = unique([...state.conditions, ...conditionsFor(inner)]);
      let pending = [];
      for (const child of children) {
        if (child.kind() === "inner_attribute_item") continue;
        if (child.kind() === "attribute_item") {
          pending.push(attributeInfo(child));
          continue;
        }
        if (COMMENT_KINDS.has(child.kind())) continue;
        if (!child.isNamed() && child.text()) continue;
        const attributes = pending;
        pending = [];
        visit(child, { ...state, conditions: inherited }, attributes);
      }
      recordAttributes(pending, state.owner?.id);
    }
    function visit(node, state, attributes = []) {
      const syntaxKind = node.kind();
      if (syntaxKind === "ERROR" || (node.text() === "" && syntaxKind !== "source_file")) {
        fileRecord.status = "recovered-with-errors";
        fileRecord.syntaxErrors++;
        warnOnce("rust.syntax-error", "Tree-sitter recovered malformed or missing syntax; declarations are partial syntax evidence.");
        unresolved(file, node, "syntax-error", node.text() || `<missing ${syntaxKind}>`, "Parser recovery; Rust validity unknown.", state.owner?.id);
        unsupportedBinding(node, state, "recovered-syntax-bindings", "Parser recovery may conceal bindings in this lexical scope.");
      }
      const conditions = unique([...state.conditions, ...conditionsFor(attributes)]);
      let owner = state.owner;
      let kind = KINDS.get(syntaxKind);
      if (kind === "function" && ["impl", "trait"].includes(owner?.kind)) kind = "method";
      if (kind) {
        const rawName = node.field("name")?.text();
        const header = signature(node);
        const name = rawName ? cleanName(rawName) : kind === "impl" ? header : kind === "extern-block" ? header : `<anonymous-${kind}>`;
        const loc = location(file, node);
        const segment = ["impl", "extern-block"].includes(kind) ? `${name}@${loc.startLine}:${loc.startColumn}` : name;
        const qualifiedName = `${state.scope}::${segment}`;
        const visibility = node.children().find((child) => child.kind() === "visibility_modifier")?.text() ?? "inherited";
        const identityKey = JSON.stringify([file.path, state.scope, kind, name]);
        const occurrence = identities.get(identityKey)?.length ?? 0;
        const id = factId("rust", kind, file.path, JSON.stringify([qualifiedName, occurrence]));
        const entity = {
          id, language: "rust", kind, name, qualifiedName, location: loc,
          exported: visibility === "pub", signatures: [header], attributes: attributes.map((attribute) => attribute.text),
          ...(owner ? { ownerId: owner.id } : {}),
        };
        contribution.entities.push(entity);
        const syntaxStatus = node.find({ rule: { kind: "ERROR" } }) ? "recovered-with-errors" : "parsed";
        const record = { entity, node, file, fileRecord, scope: state.scope, moduleScope: state.moduleScope, attributes, conditions, syntaxStatus };
        declarations.push(record);
        if (!["impl", "extern-block"].includes(kind)) {
          const records = identities.get(identityKey) ?? [];
          records.push(record);
          identities.set(identityKey, records);
        }
        metadata.push({
          entityId: id, syntaxKind, syntaxStatus, rawName: rawName ?? null, visibility, conditions,
          attributeLocations: attributes.map((attribute) => location(file, attribute.node)),
          lexicalScope: state.scope,
          ...(kind === "impl" ? { targetType: node.field("type")?.text() ?? null, traitPath: node.field("trait")?.text() ?? null } : {}),
          ...(kind === "module" ? { outOfLine: !node.field("body") } : {}),
        });
        if (rawName && kind !== "field") {
          const nameNode = kind === "extern-crate" ? node.field("alias") ?? node.field("name") : node.field("name");
          const containingScope = owner?.kind === "extern-block" ? scopesByName.get(state.scope)?.parentScope ?? state.scope : state.scope;
          binding(nameNode, { ...state, scope: containingScope, conditions }, kind, nameNode.text(), {
            entityId: id, bindingStatus: "declared",
          });
        }
        lexicalScope(qualifiedName, state.scope, kind, node, id);
        if (owner) edge(owner.id, id, "owns", loc);
        if (kind === "impl") impls.push(record);
        if (kind === "function" || kind === "method") command(entity, attributes, conditions);
        owner = entity;
        state = { ...state, scope: qualifiedName, ...(kind === "module" ? { moduleScope: qualifiedName } : {}) };
      }
      recordAttributes(attributes, owner?.id);
      if (syntaxKind === "closure_expression" || syntaxKind === "match_arm") {
        const scope = scopedName(state.scope, syntaxKind === "closure_expression" ? "closure" : "match-arm", node);
        lexicalScope(scope, state.scope, syntaxKind, node, owner?.id);
        state = { ...state, scope };
      }
      const condition = ["if_expression", "while_expression"].includes(syntaxKind) ? node.field("condition") : null;
      if (condition?.find({ rule: { kind: "let_condition" } })) {
        const scope = scopedName(state.scope, "conditional", node);
        lexicalScope(scope, state.scope, "unsupported-conditional-scope", node, owner?.id);
        state = { ...state, scope };
        unsupportedBinding(condition, { ...state, owner, conditions }, "unsupported-conditional-bindings",
          "Precise conditional binding scopes are unsupported; this conservative scope covers the condition and its branches, not surrounding statements.");
      }
      const bindingState = { ...state, owner, conditions };
      if (syntaxKind === "parameter" && node.parent()?.kind() === "parameters" &&
          ["function_item", "function_signature_item"].includes(node.parent()?.parent()?.kind())) {
        const pattern = node.field("pattern");
        if (pattern) bindPattern(pattern, bindingState, "parameter");
        else unsupportedBinding(node, bindingState, "unsupported-parameter", "Parameter binding pattern is missing or unsupported.");
      } else if (syntaxKind === "self_parameter") {
        const self = node.namedChildren().find((child) => child.kind() === "self");
        binding(self ?? node, bindingState, "parameter", "self");
      } else if (syntaxKind === "closure_parameters") {
        for (const parameter of node.namedChildren()) {
          if (COMMENT_KINDS.has(parameter.kind())) continue;
          const pattern = parameter.kind() === "parameter" ? parameter.field("pattern") : parameter;
          if (pattern) bindPattern(pattern, bindingState, "closure-parameter");
          else unsupportedBinding(parameter, bindingState, "unsupported-parameter", "Closure parameter pattern is missing.");
        }
      } else if (syntaxKind === "let_declaration") {
        const pattern = node.field("pattern");
        const end = node.range().end;
        const options = {
          availability: "after-statement",
          visibleAfter: sourceLocation(file.path, end.line + 1, end.line + 1, end.column + 1, end.column + 1),
        };
        if (pattern) bindPattern(pattern, bindingState, "let-pattern", options);
        else unsupportedBinding(node, bindingState, "unsupported-pattern", "Let declaration has no supported pattern.", options);
      } else if (syntaxKind === "for_expression") {
        const pattern = node.field("pattern");
        const body = node.field("body");
        if (pattern && body?.kind() === "block") {
          bindPattern(pattern, { ...bindingState, scope: scopedName(state.scope, "block", body) }, "for-pattern");
        } else unsupportedBinding(node, bindingState, "unsupported-pattern", "For-loop pattern/body scope is unsupported.");
      } else if (syntaxKind === "match_arm") {
        const pattern = node.field("pattern");
        if (pattern) bindPattern(pattern, bindingState, "match-pattern");
        else unsupportedBinding(node, bindingState, "unsupported-pattern", "Match-arm pattern is missing.");
      } else if (["type_parameter", "const_parameter"].includes(syntaxKind)) {
        const name = node.field("name");
        if (name) binding(name, bindingState, "generic-parameter", name.text());
      }
      if (syntaxKind === "call_expression") {
        const callee = node.field("function");
        unresolved(file, node, "call", callee?.text() ?? node.text(), "Callee spelling only; imports, receiver types, traits, cfg and dynamic dispatch are not resolved.", owner?.id);
      } else if (syntaxKind === "use_declaration") {
        unresolved(file, node, "use", node.text(), "Import/re-export tree preserved; targets and aliases not resolved.", owner?.id);
        const useDeclarationId = factId("rust", "use-declaration", file.path, String(node.range().start.index));
        extensions.useDeclarations.push({
          id: useDeclarationId, text: node.text(), location: location(file, node),
          lexicalScope: state.scope, moduleLexicalScope: state.moduleScope, conditions,
          ...(owner?.id ? { ownerId: owner.id } : {}),
        });
        const argument = node.field("argument");
        if (argument) bindUse(argument, bindingState, null, useDeclarationId);
        else unsupportedBinding(node, bindingState, "unsupported-use", "Use declaration has no parsed use tree.", { useDeclarationId });
      } else if (syntaxKind === "extern_crate_declaration") {
        unresolved(file, node, "extern-crate", node.text(), "Declared external crate; Cargo graph not resolved.", owner?.id);
      } else if (syntaxKind === "macro_invocation") {
        const macro = node.field("macro")?.text() ?? node.namedChildren()[0]?.text() ?? "";
        unresolved(file, node, "macro", node.text(), "Macro invocation tokens retained; no expansion or generated declaration inference.", owner?.id);
        warnOnce("rust.macros-unexpanded", "Macro invocations are retained as unresolved syntax facts.");
        if (macro !== "tauri::generate_handler" && ["source_file", "declaration_list", "expression_statement"].includes(node.parent()?.kind())) {
          unsupportedBinding(node, bindingState, "unexpanded-macro-bindings", "An unexpanded statement/item macro may introduce bindings in this scope.");
        }
        if (macro === "tauri::generate_handler") {
          const tree = node.namedChildren().find((child) => child.kind() === "token_tree");
          if (tree) {
            const { paths, rejected } = handlerPaths(tree);
            const registration = {
              location: location(file, node), rustPaths: paths, conditions,
              ...registrationContext(node),
              evidenceKind: "unexpanded-handler-macro", runtimeReachability: "unknown",
              ...(owner ? { ownerId: owner.id } : {}), rejectedTokens: rejected,
              pathResolution: "unresolved-token-paths",
              modulePath: null,
              lexicalScope: state.scope,
              moduleLexicalScope: state.moduleScope,
            };
            extensions.tauriRegistrations.push(registration);
            registrationRecords.set(registration, { file, node, moduleScope: state.moduleScope });
            if (registration.pluginNamespaceStatus === "unresolved") {
              unresolved(file, node, "tauri-plugin-namespace", node.text(), "Plugin builder name is not a parsed literal; plugin namespace not inferred.", owner?.id);
            }
            for (const text of rejected) unresolved(file, node, "tauri-handler-tokens", text, "Unsupported handler token group; not interpreted as a Rust path.", owner?.id);
          }
        }
        return;
      }
      if (syntaxKind === "macro_definition") {
        unresolved(file, node, "macro-definition", node.text(), "Macro definition body retained, never parsed as expanded declarations.", owner?.id);
        return;
      }
      if (COMMENT_KINDS.has(syntaxKind) || ATTRIBUTE_KINDS.has(syntaxKind) ||
          ["token_tree", "token_tree_pattern", "string_literal", "raw_string_literal", "char_literal"].includes(syntaxKind)) return;
      const next = {
        owner,
        scope: syntaxKind === "block" ? scopedName(state.scope, "block", node) : state.scope,
        conditions,
        moduleScope: state.moduleScope,
      };
      if (syntaxKind === "block") lexicalScope(next.scope, state.scope, "block", node, owner?.id);
      if (["block", "declaration_list", "source_file", "field_declaration_list", "enum_variant_list"].includes(syntaxKind)) {
        visitContainer(node, next);
      } else {
        for (const child of node.namedChildren()) visit(child, next);
      }
    }
    lexicalScope(file.path, null, "source-file", root);
    visit(root, { owner: null, scope: file.path, moduleScope: file.path, conditions: [] });
    for (const record of metadata.slice(metadataStart)) record.fileSyntaxStatus = fileRecord.status;
  }
  for (const records of identities.values()) {
    if (records.length < 2) continue;
    const { entity, file, node } = records[0];
    contribution.diagnostics.push({
      code: "rust.ambiguous-identity", severity: "warning", path: file.path,
      message: `Multiple ${entity.kind} declarations share lexical identity ${entity.qualifiedName}; cfg is not evaluated.`,
    });
    unresolved(file, node, "duplicate-identity", entity.qualifiedName, "Multiple declarations, no unique endpoint selected.", entity.ownerId, records.map((record) => record.entity.id));
  }
  const moduleContexts = new Map();
  const modules = declarations.filter((record) => record.entity.kind === "module");
  const seenModules = new Set();
  const queue = extensions.crates.flatMap((crate) => (crate.moduleRoots ?? []).map((root) => ({
    crateId: root.crateId, rootSourcePath: root.sourcePath,
    sourcePath: root.sourcePath, moduleScope: root.sourcePath, rustModulePath: "crate",
    moduleDirectory: posix.dirname(root.sourcePath), conditions: [],
    evidence: [sourceLocation(root.manifestPath, 1)], sourceChain: [root.sourcePath],
  })));
  for (let index = 0; index < queue.length; index++) {
    const context = queue[index];
    const contexts = moduleContexts.get(context.moduleScope) ?? [];
    contexts.push(context);
    moduleContexts.set(context.moduleScope, contexts);
    const children = modules.filter((record) => record.file.path === context.sourcePath && record.scope === context.moduleScope);
    for (const child of children) {
      seenModules.add(child.entity.id);
      const name = child.node.field("name")?.text() ?? "";
      const rustModulePath = `${context.rustModulePath}::${name}`;
      const conditions = unique([...context.conditions, ...child.conditions]);
      const evidence = [...context.evidence, child.entity.location];
      const mapping = {
        moduleEntityId: child.entity.id, crateId: context.crateId, rustModulePath,
        location: child.entity.location, conditions, evidence,
      };
      const inline = Boolean(child.node.field("body"));
      const sourceCandidates = !name ? [] : inline ? [child.file.path] : [
        posix.join(context.moduleDirectory, `${cleanName(name)}.rs`),
        posix.join(context.moduleDirectory, cleanName(name), "mod.rs"),
      ].filter((path) => inventory.has(path));
      let reason;
      if (!name) reason = "Module name is missing; source ownership not established.";
      else if (child.fileRecord.status !== "parsed") reason = "Module declaration is in a recovered file; source ownership not established.";
      else if (child.attributes.some((attribute) => ["path", "cfg_attr"].includes(attribute.path))) reason = "Module path/cfg_attr routing is not interpreted.";
      else if (children.filter((candidate) => candidate.entity.name === child.entity.name).length > 1) reason = "Duplicate module declarations require cfg selection; no unique module owner.";
      else if (sourceCandidates.length !== 1) reason = sourceCandidates.length ? "Both default Rust module files exist; ownership is ambiguous." : "Declared module source is absent from the captured inventory.";
      else if (!inline && context.sourceChain.includes(sourceCandidates[0])) reason = "Cyclic module-source mapping is unsupported.";
      if (reason) {
        mapping.status = sourceCandidates.length > 1 || reason.startsWith("Duplicate") ? "ambiguous" : "unresolved";
        mapping.reason = reason;
        mapping.candidates = sourceCandidates;
        unresolved(child.file, child.node, "module-source", child.node.text(), reason, child.entity.id);
      } else {
        const sourcePath = sourceCandidates[0];
        mapping.status = "established";
        mapping.sourcePath = sourcePath;
        queue.push({
          crateId: context.crateId, rootSourcePath: context.rootSourcePath,
          sourcePath, moduleScope: inline ? child.entity.qualifiedName : sourcePath,
          rustModulePath, conditions, evidence,
          moduleDirectory: posix.join(context.moduleDirectory, cleanName(name)),
          sourceChain: inline ? context.sourceChain : [...context.sourceChain, sourcePath],
        });
      }
      extensions.moduleMappings.push(mapping);
    }
  }
  for (const child of modules.filter((record) => !seenModules.has(record.entity.id) && !record.node.field("body"))) {
    const reason = "No supported Cargo-root module chain reaches this declaration; local/macro/alias/custom module contexts are not inferred.";
    extensions.moduleMappings.push({ moduleEntityId: child.entity.id, location: child.entity.location, status: "unresolved", reason, candidates: [] });
    unresolved(child.file, child.node, "module-source", child.node.text(), reason, child.entity.id);
  }
  const declarationsById = new Map(declarations.map((record) => [record.entity.id, record]));
  function pathCandidates(scope, conditions, segment) {
    return (moduleContexts.get(scope) ?? []).map((context) => ({
      crateId: context.crateId, rootSourcePath: context.rootSourcePath,
      rustModulePath: context.rustModulePath,
      ...(segment ? { rustPath: `${context.rustModulePath}::${segment}` } : {}),
      conditions: unique([...context.conditions, ...conditions]), evidence: context.evidence,
    }));
  }
  for (const command of extensions.tauriCommands) {
    const record = declarationsById.get(command.entityId);
    const candidates = record.entity.kind === "function" && record.scope === record.moduleScope &&
      record.fileRecord.status === "parsed" ? pathCandidates(record.moduleScope, command.conditions, record.node.field("name").text()) : [];
    command.rustPathCandidates = candidates;
    command.rustPathStatus = candidates.length === 1 ? "established" : candidates.length ? "ambiguous" : "unresolved";
    if (candidates.length === 1) {
      const candidate = candidates[0];
      Object.assign(command, {
        rustPath: candidate.rustPath, crateId: candidate.crateId,
        rustModulePath: candidate.rustModulePath, conditions: candidate.conditions,
        rustPathEvidence: candidate.evidence,
      });
    } else {
      unresolved(record.file, record.node, "tauri-command-path", record.entity.name,
        candidates.length ? "Multiple declared crate/module contexts; no unique command path selected." :
          "Command is not an unrecovered module-level function reached by a supported declared Cargo/module chain.",
        record.entity.id);
    }
  }
  const commandsByPath = new Map();
  for (const command of extensions.tauriCommands.filter((item) => item.rustPathStatus === "established")) {
    const key = JSON.stringify([command.crateId, command.rustPath.split("::").map(cleanName)]);
    const commands = commandsByPath.get(key) ?? [];
    commands.push(command);
    commandsByPath.set(key, commands);
  }
  for (const commands of commandsByPath.values()) {
    if (commands.length < 2) continue;
    const candidates = commands.map((command) => ({ ...command.rustPathCandidates[0], entityId: command.entityId }));
    for (const command of commands) {
      const record = declarationsById.get(command.entityId);
      command.rustPathStatus = "ambiguous";
      command.rustPathCandidates = candidates;
      for (const field of ["rustPath", "crateId", "rustModulePath", "rustPathEvidence"]) delete command[field];
      unresolved(record.file, record.node, "tauri-command-path", record.entity.name,
        "Multiple command declarations share this declared path; cfg is unevaluated and no endpoint is selected.",
        record.entity.id, commands.map((item) => item.entityId));
    }
  }
  for (const registration of extensions.tauriRegistrations) {
    const record = registrationRecords.get(registration);
    const candidates = pathCandidates(record.moduleScope, registration.conditions);
    registration.moduleContextCandidates = candidates;
    registration.moduleContextStatus = candidates.length === 1 ? "established" : candidates.length ? "ambiguous" : "unresolved";
    if (candidates.length === 1) {
      const candidate = candidates[0];
      Object.assign(registration, {
        crateId: candidate.crateId, rustModulePath: candidate.rustModulePath,
        modulePath: candidate.rustModulePath,
        conditions: candidate.conditions, moduleContextEvidence: candidate.evidence,
      });
    } else {
      unresolved(record.file, record.node, "tauri-registration-context", record.node.text(),
        "No unique declared crate/module context; handler token paths and aliases remain unresolved.", registration.ownerId);
    }
  }
  for (const implementation of impls) {
    for (const [field, kinds, relationship] of [
      ["type", ["struct", "enum", "union", "type"], "impl-for"],
      ["trait", ["trait"], "impl-trait"],
    ]) {
      const target = implementation.node.field(field);
      if (!target) continue;
      const name = cleanName(target.text());
      const parameters = implementation.node.field("type_parameters");
      const shadows = parameters?.findAll({ rule: { kind: "type_identifier" } }).some((node) => cleanName(node.text()) === name);
      const candidates = target.kind() === "type_identifier" && !shadows ? declarations.filter((record) =>
        record.file.path === implementation.file.path && record.scope === implementation.scope &&
        record.entity.name === name && kinds.includes(record.entity.kind)) : [];
      if (candidates.length === 1 && candidates[0].syntaxStatus === "parsed" && implementation.syntaxStatus === "parsed" &&
          implementation.fileRecord.status === "parsed") {
        edge(implementation.entity.id, candidates[0].entity.id, relationship, location(implementation.file, target), "syntax-explicit-unique-local-name");
      } else {
        unresolved(implementation.file, target, `impl-${field}`, target.text(),
          candidates.length > 1 ? "Ambiguous local declarations; cfg not evaluated." : "Endpoint is not a unique unrecovered direct nongeneric name in this lexical scope.",
          implementation.entity.id, candidates.map((record) => record.entity.id));
      }
    }
  }
  contribution.entities.sort((a, b) => compare(a.id, b.id));
  contribution.relationships.sort((a, b) => compare(a.id, b.id));
  contribution.unresolved.sort((a, b) => compare(a.id, b.id));
  contribution.diagnostics.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  return contribution;
}
