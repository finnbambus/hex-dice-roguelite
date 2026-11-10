// Seeded random number generator (mulberry32) so runs are reproducible by seed.
export class RNG {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n) {
    return Math.floor(this.next() * n);
  }
  pick(arr) {
    return arr[this.int(arr.length)];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  weightedIndex(weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let x = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      x -= weights[i];
      if (x < 0) return i;
    }
    return weights.length - 1;
  }
}
