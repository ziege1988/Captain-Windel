// Section 9: screen shake + hit-stop ("Zeitlupe") shared helpers.
export class ScreenShake {
  private trauma = 0; // 0..1
  offsetX = 0;
  offsetY = 0;

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number): void {
    if (this.trauma <= 0) {
      this.offsetX = 0;
      this.offsetY = 0;
      return;
    }
    this.trauma = Math.max(0, this.trauma - dt * 2.2);
    const power = this.trauma * this.trauma;
    const maxOffset = 14;
    this.offsetX = (Math.random() * 2 - 1) * maxOffset * power;
    this.offsetY = (Math.random() * 2 - 1) * maxOffset * power;
  }
}

export class HitStop {
  private remainingMs = 0;
  private originalScale = 1;

  trigger(ms: number): void {
    this.remainingMs = Math.max(this.remainingMs, ms);
  }

  /** Returns a timescale multiplier (0..1) to apply to dt this frame. */
  update(realDtMs: number): number {
    if (this.remainingMs <= 0) return 1;
    this.remainingMs -= realDtMs;
    return 0.06;
  }

  get active(): boolean {
    return this.remainingMs > 0;
  }
}
