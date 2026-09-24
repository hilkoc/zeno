/**
 * View state in the complex plane. Kept in float64 on the CPU and handed to
 * the GPU as double-single pairs, so the centre stays exact far below what a
 * float32 uniform could carry.
 */

/** Widest framing, in half-height complex units. */
const MAX_SCALE = 64;

export class Camera {
  constructor(view = { x: -0.6, y: 0, scale: 1.35 }) {
    this.x = view.x;
    this.y = view.y;
    this.scale = view.scale; // half-height of the viewport, in complex units
    this.zoomSpeed = 0; // slider position, -1 .. 1
    this.minScale = 1e-5;
    this.flight = null;
    this.version = 0;
  }

  markDirty() {
    this.version++;
  }

  set(view) {
    this.x = view.x;
    this.y = view.y;
    this.scale = Math.min(MAX_SCALE, Math.max(this.minScale, view.scale));
    this.flight = null;
    this.markDirty();
  }

  /** e-folds per second for the current slider position. */
  get rate() {
    const v = this.zoomSpeed;
    if (Math.abs(v) < 0.02) return 0;
    const t = (Math.abs(v) - 0.02) / 0.98;
    return Math.sign(v) * t * t * 2.6;
  }

  /** @returns {boolean} true when the view changed and accumulation must restart. */
  update(dt) {
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.duration);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2; // ease in/out cubic
      this.x = f.from.x + (f.to.x - f.from.x) * e;
      this.y = f.from.y + (f.to.y - f.from.y) * e;
      this.scale = Math.exp(f.from.logScale + (f.to.logScale - f.from.logScale) * e);
      if (f.t >= 1) this.flight = null;
      this.markDirty();
      return true;
    }

    const rate = this.rate;
    if (rate === 0) return false;
    const next = this.scale * Math.exp(-rate * dt);
    const clamped = Math.min(MAX_SCALE, Math.max(this.minScale, next));
    if (clamped === this.scale) return false;
    this.scale = clamped;
    this.markDirty();
    return true;
  }

  /** Zoom keeping the complex point under (ndcX, ndcY) pinned in place. */
  zoomAt(ndcX, ndcY, factor) {
    const px = this.x + ndcX * this.scale;
    const py = this.y + ndcY * this.scale;
    const next = Math.min(MAX_SCALE, Math.max(this.minScale, this.scale * factor));
    if (next === this.scale) return false;
    this.scale = next;
    this.x = px - ndcX * next;
    this.y = py - ndcY * next;
    this.markDirty();
    return true;
  }

  panPixels(dx, dy, heightPx) {
    const perPixel = (2 * this.scale) / heightPx;
    this.x -= dx * perPixel;
    this.y += dy * perPixel; // screen y grows downward, the imaginary axis upward
    this.markDirty();
  }

  /** Pixel -> complex coordinate. */
  toComplex(px, py, widthPx, heightPx) {
    const ndcX = (px - widthPx / 2) / (heightPx / 2);
    const ndcY = -(py - heightPx / 2) / (heightPx / 2);
    return { x: this.x + ndcX * this.scale, y: this.y + ndcY * this.scale };
  }

  flyTo(target, duration = 1.1) {
    this.flight = {
      t: 0,
      duration,
      from: { x: this.x, y: this.y, logScale: Math.log(this.scale) },
      to: { x: target.x, y: target.y, logScale: Math.log(target.scale) },
    };
  }

  /** Zoom factor relative to the default framing, for the HUD. */
  get magnification() {
    return 1.35 / this.scale;
  }
}
