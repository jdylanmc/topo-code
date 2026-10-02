// Original, deterministic contours sampled from a smooth scalar field.
export function contourSvg() {
  const width = 1440;
  const height = 900;
  const step = 18;
  const field = (x, y) =>
    Math.sin(x / 151 + Math.sin(y / 173)) +
    Math.cos(y / 137 - Math.cos(x / 219)) +
    .45 * Math.sin((x + y) / 91);
  const paths = [];
  for (let level = -2.4; level <= 2.4; level += .24) {
    const segments = [];
    for (let y = -step; y < height + step; y += step) {
      for (let x = -step; x < width + step; x += step) {
        const corners = [[x, y], [x + step, y], [x + step, y + step], [x, y + step]];
        const values = corners.map(([cx, cy]) => field(cx, cy));
        const crossings = [];
        for (let edge = 0; edge < 4; edge++) {
          const next = (edge + 1) % 4;
          if ((values[edge] >= level) === (values[next] >= level)) continue;
          const ratio = (level - values[edge]) / (values[next] - values[edge]);
          crossings.push(corners[edge].map((value, axis) =>
            (value + ratio * (corners[next][axis] - value)).toFixed(1)).join(","));
        }
        for (let index = 0; index + 1 < crossings.length; index += 2) {
          segments.push(`M${crossings[index]}L${crossings[index + 1]}`);
        }
      }
    }
    paths.push(`<path d="${segments.join("")}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round">${paths.join("")}</g></svg>`;
}
