import { createHash } from "node:crypto";

export function shareViewerAssets(
  html: string,
  assets: Map<string, string>,
): string {
  function asset(contents: string, extension: "js" | "css"): string {
    const name = `${createHash("sha256").update(contents).digest("hex")}.${extension}`;
    assets.set(name, contents);
    return `../../repository-runtime/${name}`;
  }
  const scripts = html.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (whole: string, attributes: string, contents: string) => {
      const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1];
      if (/\b(?:src|id)\s*=/i.test(attributes) ||
          (type !== undefined && type !== "text/javascript" && type !== "application/javascript")) return whole;
      return `<script${attributes} src="${asset(contents, "js")}"></script>`;
    },
  );
  return scripts.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, (head) =>
    head.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi,
      (whole: string, attributes: string, contents: string) => {
        const urls = [...contents.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)];
        if (/\bid\s*=/i.test(attributes) || /@import\b/i.test(contents) ||
            urls.some((match) => !/^(?:data:|https?:\/\/)/i.test(match[1]!))) return whole;
        return `<link${attributes} rel="stylesheet" href="${asset(contents, "css")}">`;
      }),
  );
}
