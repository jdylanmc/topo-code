import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.dirname(fileURLToPath(import.meta.url));
export const generated = path.join(root, '.generated');
export const upstream = path.resolve(process.env.ARCHIFY_ROOT || path.join(root, '.upstream'));
export const topoRevision = '339135da2792046a422308fbc8e5b54ead5828cd';
export const archifyRevision = 'd673e8300df60a5c8166abe78787fdc78f6b8000';

export function verifyUpstream() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'upstream-files.json'), 'utf8'));
  assert.equal(manifest.revision, archifyRevision);
  for (const [file, expected] of Object.entries(manifest.files)) {
    const source = path.join(upstream, file);
    assert.ok(fs.existsSync(source), `Missing pinned Archify file: ${source}. See README bootstrap or ARCHIFY_ROOT.`);
    const actual = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    assert.equal(actual, expected, `Pinned Archify content differs: ${file}`);
  }
}
