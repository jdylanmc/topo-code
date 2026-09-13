export const FIT_PADDING = 32;

interface Size {
  width: number;
  height: number;
}

export function fitScale(content: Size, viewport: Size): number {
  return Math.min(
    1,
    Math.max(1, viewport.width - FIT_PADDING * 2) / Math.max(1, content.width),
    Math.max(1, viewport.height - FIT_PADDING * 2) / Math.max(1, content.height),
  );
}

function assertScale(scale: number): void {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError("Camera scale must be finite and positive.");
  }
}

export class ZoomLimits {
  #minimum = 0.1;
  #maximum = 8;

  get extent(): [number, number] {
    return [this.#minimum, this.#maximum];
  }

  include(scale: number): void {
    assertScale(scale);
    // Fitted or transferred cameras must remain reachable through every zoom input.
    this.#minimum = Math.min(this.#minimum, scale);
    this.#maximum = Math.max(this.#maximum, scale);
  }

  scaleBy(current: number, factor: number): number {
    assertScale(current);
    if (Number.isNaN(factor) || factor < 0) {
      throw new RangeError("Zoom factor must be nonnegative and not NaN.");
    }
    return Math.min(this.#maximum, Math.max(this.#minimum, current * factor));
  }
}
