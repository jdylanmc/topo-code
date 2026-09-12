import { createHash } from "node:crypto";
import { normalizeRepositoryPath, serializeJson, type GraphDocument, type JsonValue } from "@topo/schema";

export interface ReportSource {
  id: string;
  tool: string;
  adapterVersion: string;
  repositoryId: string;
  revision: string;
  collectedAt: string;
}

export interface ReportMetric {
  path: string;
  key: string;
  value: number;
  unit: "count" | "percent" | "ratio" | "milliseconds";
}

export interface ReportFinding {
  id: string;
  path: string;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface ReportDocument {
  schemaVersion: "1.0";
  id: string;
  source: ReportSource;
  configuration: Record<string, JsonValue>;
  metrics: ReportMetric[];
  findings: ReportFinding[];
}

export interface DashboardDocument {
  schemaVersion: "1.0";
  repositoryId: string;
  revision: string;
  inputs: Array<{ id: string; source: ReportSource; configuration: Record<string, JsonValue>; fingerprint: string }>;
  metrics: Array<ReportMetric & { reportId: string; sourceId: string; nodeId: string; provenance: "observed" }>;
  findings: Array<ReportFinding & { reportId: string; sourceId: string; nodeId: string; provenance: "observed" }>;
}

function object(value: unknown, label: string, keys: string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const record = value as Record<string, unknown>;
  const extra = Object.keys(record).filter((key) => !keys.includes(key));
  if (extra.length) throw new Error(`${label} has unknown keys: ${extra.join(", ")}`);
  return record;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a nonempty string`);
  return value;
}

function path(value: unknown): string {
  const input = text(value, "Report path");
  if (/^[a-z]:/i.test(input) || input.includes("\0")) throw new Error("Report paths must be repository-relative");
  const normalized = normalizeRepositoryPath(input);
  if (normalized.split("/").some((part) => !part || part === ".")) throw new Error("Report paths must be canonical");
  return normalized;
}

function json(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(json);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, json(item)]));
  }
  throw new Error("Report configuration must contain only finite JSON values");
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function parseReport(input: unknown): ReportDocument {
  const value = object(input, "Report", ["schemaVersion", "id", "source", "configuration", "metrics", "findings"]);
  if (value.schemaVersion !== "1.0") throw new Error(`Unsupported report schema version: ${String(value.schemaVersion)}`);
  const sourceValue = object(value.source, "Report source", ["id", "tool", "adapterVersion", "repositoryId", "revision", "collectedAt"]);
  const source: ReportSource = {
    id: text(sourceValue.id, "Source id"),
    tool: text(sourceValue.tool, "Source tool"),
    adapterVersion: text(sourceValue.adapterVersion, "Adapter version"),
    repositoryId: text(sourceValue.repositoryId, "Repository id"),
    revision: text(sourceValue.revision, "Source revision"),
    collectedAt: text(sourceValue.collectedAt, "Collection time"),
  };
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(source.collectedAt) ||
      !Number.isFinite(Date.parse(source.collectedAt)) ||
      new Date(source.collectedAt).toISOString().replace(".000Z", "Z") !== source.collectedAt.replace(".000Z", "Z")) {
    throw new Error("Collection time must be an ISO UTC timestamp");
  }
  const configuration = json(object(value.configuration, "Report configuration", Object.keys(
    typeof value.configuration === "object" && value.configuration !== null ? value.configuration : {},
  )));
  if (typeof configuration !== "object" || configuration === null || Array.isArray(configuration)) {
    throw new Error("Report configuration must be an object");
  }
  const metrics = array(value.metrics, "Report metrics").map((inputMetric): ReportMetric => {
    const metric = object(inputMetric, "Metric", ["path", "key", "value", "unit"]);
    const metricPath = path(metric.path);
    const key = text(metric.key, "Metric key");
    if (typeof metric.value !== "number" || !Number.isFinite(metric.value)) throw new Error(`Metric ${key} must be finite`);
    const unit = metric.unit;
    if (unit !== "count" && unit !== "percent" && unit !== "ratio" && unit !== "milliseconds") throw new Error(`Unsupported unit: ${String(unit)}`);
    if (metric.value < 0 || (unit === "percent" && metric.value > 100) || (unit === "ratio" && metric.value > 1) ||
        (unit === "count" && !Number.isSafeInteger(metric.value))) throw new Error(`Metric ${key} is outside its unit range`);
    return { path: metricPath, key, value: metric.value, unit };
  }).sort((a, b) => compare(`${a.path}\0${a.key}`, `${b.path}\0${b.key}`));
  const findings = array(value.findings, "Report findings").map((inputFinding): ReportFinding => {
    const finding = object(inputFinding, "Finding", ["id", "path", "severity", "message"]);
    const severity = finding.severity;
    if (severity !== "info" && severity !== "warning" && severity !== "error") throw new Error("Invalid finding severity");
    return { id: text(finding.id, "Finding id"), path: path(finding.path), severity, message: text(finding.message, "Finding message") };
  }).sort((a, b) => compare(a.id, b.id));
  if (new Set(metrics.map((metric) => `${metric.path}\0${metric.key}`)).size !== metrics.length) throw new Error("Duplicate report metric");
  if (new Set(findings.map((finding) => finding.id)).size !== findings.length) throw new Error("Duplicate report finding");
  return { schemaVersion: "1.0", id: text(value.id, "Report id"), source, configuration, metrics, findings };
}

export function serializeReport(report: ReportDocument): string {
  return serializeJson(reportJson(parseReport(report)));
}

function reportJson(report: ReportDocument): JsonValue {
  return {
    ...report,
    source: { ...report.source },
    metrics: report.metrics.map((metric) => ({ ...metric })),
    findings: report.findings.map((finding) => ({ ...finding })),
  };
}

export function normalizeReports(inputs: unknown[], graph: GraphDocument): DashboardDocument {
  if (!inputs.length) throw new Error("At least one report is required");
  const revision = graph.repository.revision;
  if (!revision) throw new Error("Report ingestion requires a versioned repository revision");
  const reports = new Map<string, { report: ReportDocument; fingerprint: string }>();
  const nodesByPath = new Map(graph.nodes.filter((node) => node.identity.kind === "path").map((node) => [node.identity.value, node.id]));
  for (const input of inputs) {
    const report = parseReport(input);
    if (report.source.repositoryId !== graph.repository.id) throw new Error(`Report ${report.id} belongs to another repository`);
    if (report.source.revision !== revision) throw new Error(`Stale report ${report.id}: expected revision ${revision}, received ${report.source.revision}`);
    const fingerprint = createHash("sha256").update(serializeReport(report)).digest("hex");
    const prior = reports.get(report.id);
    if (prior && prior.fingerprint !== fingerprint) throw new Error(`Conflicting report id: ${report.id}`);
    reports.set(report.id, { report, fingerprint });
  }
  const dashboard: DashboardDocument = {
    schemaVersion: "1.0", repositoryId: graph.repository.id, revision, inputs: [], metrics: [], findings: [],
  };
  const metricEvidence = new Map<string, { value: number; unit: ReportMetric["unit"]; reportId: string }>();
  for (const { report, fingerprint } of [...reports.values()].sort((a, b) => compare(a.report.id, b.report.id))) {
    dashboard.inputs.push({ id: report.id, source: { ...report.source }, configuration: report.configuration, fingerprint });
    for (const metric of report.metrics) {
      const nodeId = nodesByPath.get(metric.path);
      if (!nodeId) throw new Error(`Report ${report.id} references unscanned file ${metric.path}`);
      const key = `${metric.path}\0${metric.key}`;
      const prior = metricEvidence.get(key);
      if (prior && (prior.value !== metric.value || prior.unit !== metric.unit)) {
        throw new Error(`Conflicting sources for ${metric.path} ${metric.key}: reports ${prior.reportId} and ${report.id}`);
      }
      metricEvidence.set(key, { value: metric.value, unit: metric.unit, reportId: report.id });
      dashboard.metrics.push({ ...metric, reportId: report.id, sourceId: report.source.id, nodeId, provenance: "observed" });
    }
    for (const finding of report.findings) {
      const nodeId = nodesByPath.get(finding.path);
      if (!nodeId) throw new Error(`Report ${report.id} references unscanned file ${finding.path}`);
      dashboard.findings.push({ ...finding, reportId: report.id, sourceId: report.source.id, nodeId, provenance: "observed" });
    }
  }
  return dashboard;
}

export function serializeDashboard(dashboard: DashboardDocument): string {
  return serializeJson({
    ...dashboard,
    inputs: dashboard.inputs.map((input) => ({ ...input, source: { ...input.source } })),
    metrics: dashboard.metrics.map((metric) => ({ ...metric })),
    findings: dashboard.findings.map((finding) => ({ ...finding })),
  });
}
