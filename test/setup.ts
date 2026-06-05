/**
 * Test environment polyfills. jsdom (as bundled with vitest) does not implement
 * the canvas `ImageData` class, which our pure compositor/IO code constructs.
 * Provide a minimal, spec-compatible stand-in so headless tests can run.
 */
class ImageDataPolyfill {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  constructor(a: number | Uint8ClampedArray, b: number, c?: number) {
    if (a instanceof Uint8ClampedArray) {
      this.data = a;
      this.width = b;
      this.height = c ?? a.length / 4 / b;
    } else {
      this.width = a;
      this.height = b;
      this.data = new Uint8ClampedArray(a * b * 4);
    }
  }
}

if (typeof (globalThis as any).ImageData === 'undefined') {
  (globalThis as any).ImageData = ImageDataPolyfill;
}
