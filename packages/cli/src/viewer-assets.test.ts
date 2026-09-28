import { describe, expect, it } from "vitest";
import { shareViewerAssets } from "./viewer-assets.js";

describe("shared generated viewer assets", () => {
  it("deduplicates exact runtime bytes without moving document data or SVG styles", () => {
    const assets = new Map<string, string>();
    const input = '<html><head><style>:root{color:black}</style><script>window.ready=true;</script></head><body><svg><style>.node{fill:blue}</style></svg><script type="application/json">{"id":1}</script><script type="module">import "./local.js";</script></body></html>';
    const first = shareViewerAssets(input, assets);
    const second = shareViewerAssets(input.replace('{"id":1}', '{"id":2}'), assets);
    expect(assets.size).toBe(2);
    expect(first).toContain('<svg><style>.node{fill:blue}</style></svg>');
    expect(first).toContain('<script type="application/json">{"id":1}</script>');
    expect(second).toContain('<script type="application/json">{"id":2}</script>');
    expect(first).toContain('<script type="module">import "./local.js";</script>');
    const restored = first
      .replace(/<link([^>]*) rel="stylesheet" href="\.\.\/\.\.\/repository-runtime\/([^"]+)">/g,
        (_whole, attributes, name) => `<style${attributes}>${assets.get(name)}</style>`)
      .replace(/<script([^>]*) src="\.\.\/\.\.\/repository-runtime\/([^"]+)"><\/script>/g,
        (_whole, attributes, name) => `<script${attributes}>${assets.get(name)}</script>`);
    expect(restored).toBe(input);
  });

  it("leaves relative CSS resources and existing external scripts in their original context", () => {
    const assets = new Map<string, string>();
    const input = '<head><style>.a{filter:url(#local)}</style><style>@import "./local.css";</style><style id="archify-fonts">@font-face{font-family:Mono}</style><script id="inspectable">window.ready=true;</script><script src="./existing.js"></script></head>';
    expect(shareViewerAssets(input, assets)).toBe(input);
    expect(assets.size).toBe(0);
  });
});
