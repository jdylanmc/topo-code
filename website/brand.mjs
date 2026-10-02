import { themes } from "./themes.mjs";

export const contourPath = "M16 3C22 2 24 7 27 12C31 19 26 27 19 29C12 31 4 27 3 20C2 14 7 12 9 7C10 4 13 3 16 3Z M16 9C20 8 21 12 23 15C26 20 22 24 18 24C13 26 8 23 8 19C8 15 12 14 12 11C13 9 14 9 16 9Z M17 15C20 15 20 18 20 19C19 22 14 21 14 19C14 17 15 15 17 15Z";

export function contourIcon(favicon = false) {
  const theme = themes.blueprint;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" focusable="false"${favicon ? ` style="color:${theme.accent}"` : ""}>${favicon ? `<rect width="32" height="32" rx="6" fill="${theme.bg}"/>` : ""}<path d="${contourPath}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
}
