import { resolve } from "node:path";
import ts from "typescript-compiler-api";
import { compare, emptyContribution, factId, serialize, sourceLocation } from "../contract.mjs";

export const manifest = { id: "tauri", kind: "framework", requires: ["typescript", "rust"] };

/** @param {import("../contract-types.js").ScanContext} context
 * @param {readonly import("../contract-types.js").Contribution[]} contributions
 * @returns {Promise<import("../contract-types.js").Contribution>} */
export async function scanTauri(context, contributions) {
  const result = emptyContribution("tauri", "framework", ["typescript", "javascript", "rust"],
    ["source-command-registrations", "literal-invocations", "bounded-constant-invocations", "known-wrapper-call-sites"]);
  const rust = contributions.find(({ plugin }) => plugin.id === "rust");
  if (!rust) throw new Error("Tauri analysis requires the Rust contribution");
  const sourceFiles = context.files.filter(({ path }) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path));
  const sources = new Map(sourceFiles.map((file) => [
    resolve(context.root, file.path),
    ts.createSourceFile(resolve(context.root, file.path), file.contents, ts.ScriptTarget.Latest, true),
  ]));
  const options = {
    allowJs: true, checkJs: false, noEmit: true, noLib: true,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ESNext, skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (path) => sources.get(resolve(path));
  host.readFile = (path) => context.files.find((file) => resolve(context.root, file.path) === resolve(path))?.contents;
  host.fileExists = (path) => sources.has(resolve(path)) || context.files.some((file) => resolve(context.root, file.path) === resolve(path));
  host.writeFile = () => { throw new Error("The framework analyzer must never emit compiler output"); };
  host.getCurrentDirectory = () => context.root;
  const program = ts.createProgram([...sources.keys()], options, host);
  const checker = program.getTypeChecker();
  const paths = new Map(sourceFiles.map((file) => [resolve(context.root, file.path), file.path]));
  const calls = [];
  const writtenSymbols = new Set();
  const writtenReceiverTypes = new Set();
  const opaqueFunctions = new Set();
  function propertyKey(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node) || seen.size > 8) return undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node)) return node.text;
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const definitions = symbol?.declarations ?? [];
      if (writtenSymbols.has(symbol) || definitions.length !== 1) return undefined;
      const declaration = definitions[0];
      if (isConst(declaration)) return propertyKey(declaration.initializer, new Set(seen).add(node));
    }
    return undefined;
  }
  function memberSymbol(node) {
    if (ts.isPropertyAccessExpression(node)) return checker.getSymbolAtLocation(node.name);
    const key = propertyKey(node.argumentExpression);
    return key === undefined ? undefined : checker.getPropertyOfType(checker.getTypeAtLocation(node.expression), key);
  }
  function writtenTarget(node) {
    node = unwrap(node);
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol) writtenSymbols.add(symbol);
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const symbol = memberSymbol(node);
      if (symbol) writtenSymbols.add(symbol);
      if (ts.isElementAccessExpression(node) && propertyKey(node.argumentExpression) === undefined) {
        writtenReceiverTypes.add(checker.getTypeAtLocation(node.expression));
      }
    } else if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach(writtenTarget);
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) writtenTarget(property.initializer);
        else if (ts.isShorthandPropertyAssignment(property)) {
          const symbol = checker.getShorthandAssignmentValueSymbol(property);
          if (symbol) writtenSymbols.add(symbol);
        } else if (ts.isSpreadAssignment(property)) writtenTarget(property.expression);
      }
    } else if (ts.isSpreadElement(node) || ts.isParenthesizedExpression(node)) {
      writtenTarget(node.expression);
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      writtenTarget(node.left);
    }
  }
  const parsed = [];
  for (const source of sources.values()) {
    const path = paths.get(source.fileName);
    if (source.parseDiagnostics.length) {
      result.diagnostics.push({ code: "tauri-frontend-parse-error", severity: "error",
        message: "Frontend syntax errors prevented trustworthy invocation extraction.", path });
      continue;
    }
    parsed.push(path);
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        calls.push(node);
        if (ts.isIdentifier(unwrap(node.expression)) && unwrap(node.expression).text === "eval") {
          for (let owner = node.parent; owner; owner = owner.parent) if (ts.isFunctionLike(owner)) opaqueFunctions.add(owner);
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) writtenTarget(node.left);
      if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
          [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) writtenTarget(node.operand);
      if (ts.isDeleteExpression(node)) writtenTarget(node.expression);
      if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
          !ts.isVariableDeclarationList(node.initializer)) writtenTarget(node.initializer);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  function location(node) {
    const source = node.getSourceFile();
    const start = source.getLineAndCharacterOfPosition(node.getStart(source));
    const end = source.getLineAndCharacterOfPosition(node.getEnd());
    return sourceLocation(paths.get(source.fileName), start.line + 1, end.line + 1, start.character + 1, end.character + 1);
  }
  function unwrap(node) {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node))) {
      node = node.expression;
    }
    return node;
  }
  function declarations(node, aliases = false) {
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol) return [];
    if (aliases && symbol.flags & ts.SymbolFlags.Alias) {
      return checker.getAliasedSymbol(symbol).declarations ?? [];
    }
    return symbol.declarations ?? [];
  }
  function importedFromCore(node) {
    while (node && !ts.isImportDeclaration(node)) node = node.parent;
    return node && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "@tauri-apps/api/core";
  }
  function isConst(declaration) {
    return ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent) &&
      Boolean(declaration.parent.flags & ts.NodeFlags.Const);
  }
  function isInvoke(expression, seen = new Set()) {
    expression = unwrap(expression);
    if (!expression || seen.has(expression)) return false;
    const next = new Set(seen).add(expression);
    if (ts.isIdentifier(expression)) {
      return declarations(expression).some((declaration) => {
        if (ts.isImportSpecifier(declaration)) {
          return !declaration.isTypeOnly && (declaration.propertyName ?? declaration.name).text === "invoke" &&
            importedFromCore(declaration);
        }
        return isConst(declaration) && declaration.initializer && isInvoke(declaration.initializer, next);
      });
    }
    const member = ts.isPropertyAccessExpression(expression) ? expression.name.text :
      ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)
        ? expression.argumentExpression.text : undefined;
    return member === "invoke" && declarations(expression.expression).some((declaration) =>
      ts.isNamespaceImport(declaration) && importedFromCore(declaration));
  }
  function functionForCall(call) {
    const expression = unwrap(call.expression);
    const member = ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression);
    if (member && (writtenReceiverTypes.has(checker.getTypeAtLocation(expression.expression)) ||
        writtenSymbols.has(checker.getSymbolAtLocation(unwrap(expression.expression))))) return [];
    let symbol = member ? memberSymbol(expression) : checker.getSymbolAtLocation(expression);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    if (writtenSymbols.has(symbol)) return [];
    return (symbol?.declarations ?? []).flatMap((declaration) => {
      if ((ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) && declaration.body) return [declaration];
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const initializer = unwrap(declaration.initializer);
        if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) return [initializer];
      }
      return [];
    });
  }
  const callsByFunction = new Map();
  for (const call of calls) {
    for (const fn of functionForCall(call)) {
      const list = callsByFunction.get(fn) ?? [];
      list.push(call);
      callsByFunction.set(fn, list);
    }
  }
  function positionalArgument(elements, index) {
    return elements.slice(0, index + 1).some((element) => ts.isSpreadElement(element))
      ? undefined : elements[index];
  }
  function strings(node, seen = new Set(), depth = 0) {
    node = unwrap(node);
    if (!node || depth > 8 || seen.has(node)) return { values: [], complete: false };
    const next = new Set(seen).add(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return { values: [{ value: node.text, origin: location(node), evidence: [location(node)] }], complete: true };
    }
    if (ts.isConditionalExpression(node)) {
      const a = strings(node.whenTrue, next, depth + 1);
      const b = strings(node.whenFalse, next, depth + 1);
      return { values: [...a.values, ...b.values], complete: a.complete && b.complete };
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const a = strings(node.left, next, depth + 1);
      const b = strings(node.right, next, depth + 1);
      if (!a.complete || !b.complete || a.values.length * b.values.length > 32) return { values: [], complete: false };
      return { values: a.values.flatMap((left) => b.values.map((right) => ({
        value: left.value + right.value, origin: location(node), evidence: [...left.evidence, ...right.evidence],
      }))), complete: true };
    }
    if (ts.isIdentifier(node)) {
      const definitions = declarations(node, true);
      if (definitions.length !== 1) return { values: [], complete: false };
      const declaration = definitions[0];
      if (isConst(declaration) && declaration.initializer) {
        return strings(declaration.initializer, next, depth + 1);
      }
      if (ts.isParameter(declaration)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (declaration.dotDotDotToken || writtenSymbols.has(symbol) || opaqueFunctions.has(declaration.parent)) return { values: [], complete: false };
        const fn = declaration.parent;
        const index = fn.parameters?.indexOf(declaration);
        if (index === undefined || index < 0) return { values: [], complete: false };
        const invocations = callsByFunction.get(fn) ?? [];
        const values = invocations.flatMap((call) => strings(positionalArgument(call.arguments, index), next, depth + 1).values.map((value) => ({
          ...value, bindingSite: value.bindingSite ?? location(call), evidence: [...value.evidence, location(call)],
        })));
        // Known call sites are evidence; this is not a closed-world caller inventory.
        return { values, complete: false };
      }
      if (ts.isBindingElement(declaration) && ts.isArrayBindingPattern(declaration.parent)) {
        if (declaration.dotDotDotToken) return { values: [], complete: false };
        const binding = declaration.parent;
        const variable = binding.parent;
        const statement = variable.parent?.parent;
        if (isConst(variable) && ts.isForOfStatement(statement) && ts.isArrayLiteralExpression(statement.expression)) {
          const index = binding.elements.indexOf(declaration);
          const parts = statement.expression.elements.map((element) =>
            ts.isArrayLiteralExpression(element) ? strings(positionalArgument(element.elements, index), next, depth + 1) : { values: [], complete: false });
          return { values: parts.flatMap(({ values }) => values), complete: parts.every(({ complete }) => complete) };
        }
      }
    }
    return { values: [], complete: false };
  }
  const entities = contributions.flatMap(({ entities }) => entities);
  function position(lineA, columnA, lineB, columnB) {
    return lineA - lineB || columnA - columnB;
  }
  function owner(source) {
    const candidates = entities.filter((entity) => entity.location.path === source.path &&
      position(entity.location.startLine, entity.location.startColumn, source.startLine, source.startColumn) <= 0 &&
      position(entity.location.endLine, entity.location.endColumn, source.endLine, source.endColumn) >= 0);
    candidates.sort((a, b) => position(b.location.startLine, b.location.startColumn, a.location.startLine, a.location.startColumn) ||
      position(a.location.endLine, a.location.endColumn, b.location.endLine, b.location.endColumn) || compare(a.id, b.id));
    if (candidates.length > 1 && serialize(candidates[0].location) === serialize(candidates[1].location)) {
      return factId("core", "file", source.path, source.path);
    }
    return candidates[0]?.id ?? factId("core", "file", source.path, source.path);
  }
  const commands = rust.extensions.tauriCommands ?? [];
  const registrations = rust.extensions.tauriRegistrations ?? [];
  const rustEntities = new Map(rust.entities.map((entity) => [entity.id, entity]));
  const lexicalScopes = new Map((rust.extensions.lexicalScopes ?? []).map((scope) => [scope.lexicalScope, scope]));
  const lexicalBindings = rust.extensions.lexicalBindings ?? [];
  function normalizedRustPath(path) {
    return path.replace(/\s+/g, "");
  }
  function registrationPath(path, modulePath) {
    path = normalizedRustPath(path);
    if (path.startsWith("crate::")) return path;
    if (!modulePath || !/^crate(?:::|$)/.test(modulePath) || path.startsWith("::")) return undefined;
    const scope = normalizedRustPath(modulePath).split("::");
    if (path.startsWith("self::")) path = path.slice("self::".length);
    while (path.startsWith("super::")) {
      if (scope.length <= 1) return undefined;
      scope.pop();
      path = path.slice("super::".length);
    }
    return `${scope.join("::")}::${path}`;
  }
  function unqualifiedPathSupported(registration, path, command) {
    path = normalizedRustPath(path);
    if (/^(?:crate|self|super)::/.test(path)) return true;
    if (!registration.lexicalScope || !registration.moduleLexicalScope) return false;
    const ancestors = new Set();
    let scope = registration.lexicalScope;
    while (scope !== null && scope !== undefined) {
      if (ancestors.has(scope)) return false;
      ancestors.add(scope);
      if (scope === registration.moduleLexicalScope) break;
      const descriptor = lexicalScopes.get(scope);
      if (!descriptor || descriptor.status !== "established") return false;
      scope = descriptor.parentScope;
    }
    if (!ancestors.has(registration.moduleLexicalScope)) return false;
    const first = path.split("::")[0].replace(/^r#/, "");
    for (const binding of lexicalBindings) {
      if (!ancestors.has(binding.lexicalScope) || !binding.wildcard && binding.name !== first) continue;
      if (binding.availability === "after-statement" && binding.visibleAfter &&
          position(binding.visibleAfter.endLine, binding.visibleAfter.endColumn,
            registration.location.startLine, registration.location.startColumn) > 0) continue;
      if (binding.entityId === command.entityId) continue;
      const entity = rustEntities.get(binding.entityId);
      if (binding.lexicalScope === registration.moduleLexicalScope &&
          entity?.kind === "module" && path.includes("::")) continue;
      return false;
    }
    return true;
  }
  function matchingRegistrations(command) {
    if (!command.rustPath || !command.crateId) return [];
    return registrations.filter((registration) => registration.registrationKind === "app-builder" &&
      registration.crateId === command.crateId &&
      registration.rustPaths.some((path) => registrationPath(path, registration.modulePath) === normalizedRustPath(command.rustPath) &&
        unqualifiedPathSupported(registration, path, command)));
  }
  const bindings = [];
  const unresolved = new Map();
  const edges = new Map();
  function recordUnresolved(call, text, reason, source = location(call)) {
    const id = factId("tauri", "unresolved-invoke", source.path,
      `${source.startLine}:${source.startColumn}:${text}:${reason}`);
    unresolved.set(id, { id, kind: "tauri-invocation", text, reason, location: source, ownerId: owner(source) });
  }
  for (const registration of registrations) {
    if (registration.registrationKind !== "app-builder") continue;
    for (const path of registration.rustPaths) {
      const resolved = registrationPath(path, registration.modulePath);
      const targets = commands.filter((command) => resolved && command.crateId &&
        command.crateId === registration.crateId && normalizedRustPath(command.rustPath ?? "") === resolved &&
        unqualifiedPathSupported(registration, path, command));
      if (targets.length !== 1) {
        const id = factId("tauri", "unresolved-handler", registration.location.path,
          `${registration.location.startLine}:${registration.location.startColumn}:${path}`);
        unresolved.set(id, {
          id, kind: "tauri-handler-entry", text: path,
          reason: "The declared handler entry has no unique source command without lexical shadowing/import/opaque-binding ambiguity in the supported scope.",
          location: registration.location, ownerId: owner(registration.location),
        });
        continue;
      }
      const command = targets[0];
      const id = factId("tauri", "handler-entry", registration.location.path,
        `${registration.location.startLine}:${registration.location.startColumn}:${command.entityId}`);
      edges.set(id, {
        id, from: owner(registration.location), to: command.entityId,
        kind: "tauri-handler-entry", method: "declared-generate_handler-entry",
        evidence: [registration.location, command.location],
      });
    }
  }
  for (const call of calls.filter((candidate) => isInvoke(candidate.expression))) {
    const invokeSite = location(call);
    const names = strings(call.arguments[0]);
    if (!names.complete) recordUnresolved(call, call.arguments[0]?.getText() ?? "(missing)",
      "Command expression is dynamic or the helper caller inventory is not closed; only separately enumerated known bindings are shown.");
    for (const name of names.values) {
      const bindingSite = name.bindingSite ?? invokeSite;
      const candidates = commands.map((command) => ({ command, registrations: matchingRegistrations(command) }))
        .filter(({ command, registrations }) => command.commandName === name.value && registrations.length);
      if (candidates.length !== 1) {
        recordUnresolved(call, name.value, candidates.length
          ? "Multiple source-declared command targets/registrations are possible."
          : "No uniquely supported in-repository command registration was resolved; plugin or dynamic registrations may exist.", bindingSite);
        continue;
      }
      const { command, registrations: registered } = candidates[0];
      const from = owner(bindingSite);
      const evidence = [...new Map([
        invokeSite, ...name.evidence, command.location, ...registered.map(({ location }) => location),
      ].map((item) => [serialize(item), item])).values()]
        .sort((a, b) => compare(a.path, b.path) || a.startLine - b.startLine || a.startColumn - b.startColumn);
      const id = factId("tauri", "invokes", bindingSite.path,
        `${bindingSite.startLine}:${bindingSite.startColumn}:${invokeSite.path}:${invokeSite.startLine}:${invokeSite.startColumn}:${name.value}:${command.entityId}`);
      const relationship = { id, from, to: command.entityId, kind: "tauri-command-binding",
        method: "source-import-and-bounded-string-flow-plus-declared-handler-registration", evidence };
      edges.set(id, relationship);
      bindings.push({ relationshipId: id, commandName: name.value, invokeSite, callSite: bindingSite,
        conditions: [...new Set([...(command.conditions ?? []), ...registered.flatMap((r) => r.conditions ?? [])])],
        runtimeReachability: "not-established" });
    }
  }
  result.relationships = [...edges.values()].sort((a, b) => compare(a.id, b.id));
  result.unresolved = [...unresolved.values()].sort((a, b) => compare(a.id, b.id));
  result.coverage.analyzedFiles = [...new Set([
    ...parsed, ...commands.map(({ location }) => location.path), ...registrations.map(({ location }) => location.path),
  ])].sort(compare);
  result.coverage.status = "partial";
  result.coverage.limitations = [
    "Bindings describe source structure, not runtime execution, authorization, permissions or reachability.",
    "Only explicit app generate_handler registrations with established Rust paths are joined.",
    "Plugin/custom/generated registrations and non-enumerable dynamic command names remain unresolved.",
    "Helper propagation enumerates known local call sites, not all potential callers.",
    "Rest values and parameter/binding positions affected by preceding spreads remain unresolved; arrays are not scalar command strings.",
    "Known member writes invalidate that helper; unknown computed writes conservatively invalidate helper propagation for the receiver type.",
    "Rust cfg conditions, procedural macros and build-time pruning are not evaluated.",
  ];
  result.extensions = {
    declaredCommands: commands.length,
    registrationSites: registrations.length,
    invocationSites: calls.filter((call) => isInvoke(call.expression)).length,
    bindings: [...new Map(bindings.map((binding) => [serialize(binding), binding])).values()]
      .sort((a, b) => compare(a.relationshipId, b.relationshipId)),
  };
  return result;
}
