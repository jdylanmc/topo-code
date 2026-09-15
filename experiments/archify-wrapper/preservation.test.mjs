import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { root, topoRevision, archifyRevision } from './paths.mjs';

const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const json = file => JSON.parse(read(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const capture = json('capture-sha256.json').files;
const native = file => JSON.parse(json(file).stdout);

test('every captured byte is preserved, and all JSON envelopes parse', () => {
  assert.ok(Object.keys(capture).length >= 88);
  for (const [file, receipt] of Object.entries(capture)) {
    const bytes = fs.readFileSync(path.join(root, file));
    assert.equal(bytes.length, receipt.bytes, file);
    assert.equal(sha(bytes), receipt.sha256, file);
    if (file.endsWith('.json')) {
      const data = JSON.parse(bytes);
      if (typeof data.stdout === 'string' && data.stdout.trim().startsWith('{')) {
        JSON.parse(data.stdout);
      }
    }
  }
});

test('required fixtures, receipts, screenshots, and applicable notices exist', () => {
  for (const name of ['overview', 'generation', 'loading', 'base', 'head', 'moved',
    'invalid', 'missing-source', 'missing-endpoint', 'node-link']) {
    assert.ok(capture[`specs/${name}.json`], name);
  }
  for (const name of ['overview', 'generation', 'loading']) {
    for (const suffix of ['html', 'json']) {
      assert.ok(capture[`site/pr-34/${name}.artifact.visual-check.${suffix}`]);
    }
  }
  for (const file of ['evidence/overview.json', 'evidence/results.json',
    'evidence/browser-1789503874206.json', 'evidence/overview-wrapper.png',
    'evidence/overview-export.svg', 'evidence/original-experiment.mjs.txt',
    'evidence/original-browser.mjs.txt', 'site/pr-34/mapping.json',
    'site/pr-34/delta.artifact.receipt.json', 'site/pr-34/movement.artifact.receipt.json']) {
    assert.ok(capture[file], file);
  }
  assert.match(read('licenses/Archify-MIT.txt'), /Copyright \(c\) 2026 tt-a1i/);
  assert.match(read('licenses/Archify-MIT.txt'), /Copyright \(c\) 2025 Cocoon AI/);
  assert.match(read('licenses/JetBrainsMono-OFL.txt'), /SIL OPEN FONT LICENSE/);
  assert.match(read('licenses/Archify-THIRD-PARTY-NOTICES.md'), /JetBrains Mono/);
});

test('static local links resolve including iframe and contact-sheet assets', () => {
  const htmlFiles = Object.keys(capture).filter(file => file.endsWith('.html'));
  for (const file of htmlFiles) {
    for (const [, target] of read(file).matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
      if (/^(?:[a-z]+:|#|\/\/)/i.test(target) || target.includes('${')) continue;
      const relative = decodeURIComponent(target.split(/[?#]/)[0]);
      if (!relative) continue;
      assert.ok(fs.existsSync(path.resolve(root, path.dirname(file), relative)), `${file}: ${target}`);
    }
  }
  for (const file of ['README.md', 'PROVENANCE.md', 'VISION.md']) {
    for (const [, target] of read(file).matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:https?:|#)/.test(target)) continue;
      assert.ok(fs.existsSync(path.resolve(root, target.split('#')[0])), `${file}: ${target}`);
    }
  }
  assert.equal(read('site/pr-34/index.html'), read('site/pr-34/overview.html'));
});

test('native receipts preserve source pin, artifact hash and pending review', () => {
  const delivery = native('evidence/overview-1789503795616.json');
  assert.equal(delivery.evidence.revision, topoRevision);
  assert.equal(delivery.evidence.references, 8);
  assert.equal(delivery.artifact.sha256, capture['site/pr-34/overview.artifact.html'].sha256);
  assert.equal(delivery.artifact.bytes, 806921);
  const mapping = json('site/pr-34/mapping.json');
  assert.equal(mapping.revision, topoRevision);
  assert.equal(new Set(mapping.nodes.map(node => node.diagramId)).size, 8);
  assert.ok(mapping.nodes.every(node => node.interpretation === 'inferred' && /^[a-f0-9]{64}$/.test(node.blobHash)));
  for (const name of ['overview', 'generation', 'loading']) {
    assert.match(read(`site/pr-34/${name}.artifact.visual-check.json`), /"visualReview":\s*"pending"/);
  }
  const results = json('evidence/results.json');
  assert.equal(results.archifyRevision, archifyRevision);
  assert.equal(results.topoRevision, topoRevision);
});

test('failure diagnostics and comparison classifications remain inspectable', () => {
  const failure = native('evidence/overview.json');
  assert.equal(failure.ok, false);
  assert.match(failure.error, /labelAt \[900, 174\]/);
  assert.deepEqual(failure.diagnostics[0].supportedFixes, []);
  assert.deepEqual(failure.diagnostics[0].evidence, {});
  assert.equal(json('evidence/native-node-hyperlink-unsupported-1789503797231.json').status, 1);
  const delta = json('site/pr-34/delta.artifact.receipt.json');
  assert.equal(delta.summary.components.added, 1);
  assert.equal(delta.summary.components.changed, 1);
  assert.equal(delta.summary.connections.added, 2);
  assert.equal(delta.summary.connections.removed, 1);
  const movement = json('site/pr-34/movement.artifact.receipt.json');
  assert.equal(movement.summary.components.moved, 1);
  assert.equal(movement.summary.components.changed, 0);
  assert.equal(movement.changes.connections.length, 0);
  const browser = json('evidence/browser-1789503874206.json');
  assert.deepEqual(browser.errors, []);
  assert.ok(browser.observations.some(item => item.name === 'local-file-preview-navigation' && item.passed));
  const navigation = browser.observations.find(item => item.name === 'shell-cross-page-context');
  assert.equal(navigation.focusRestoredAfterNavigation, false);
});

test('portable executable scripts isolate output and pin upstream', () => {
  for (const file of ['experiment.mjs', 'browser.mjs', 'paths.mjs']) {
    assert.doesNotMatch(read(file), /\/Users\/|\/Applications\/|session-state|node_modules\/playwright\/index/);
  }
  assert.match(read('experiment.mjs'), /verifyUpstream\(\)/);
  assert.match(read('experiment.mjs'), /path\.join\(generated, 'site\/pr-34'\)/);
  assert.match(read('browser.mjs'), /path\.join\(generated,'browser-evidence'\)/);
  assert.match(read('browser.mjs'), /finally/);
  assert.match(read('.gitignore'), /\.generated\//);
  const upstream = json('upstream-files.json');
  assert.equal(upstream.revision, archifyRevision);
  assert.ok(upstream.files['archify/bin/archify.mjs']);
  assert.equal(Object.keys(upstream.files).length, 214);
});
