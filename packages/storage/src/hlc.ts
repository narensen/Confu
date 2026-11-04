// A hybrid logical clock: each change gets a timestamp that sorts the same
// way on every device, even with skewed clocks. Two devices editing the same
// row keep the later edit (last writer wins).
//
//   "000001730712345678:00003:dev-abc"
//    wall-clock ms (padded) : counter : device

export type Hlc = { ms: number; counter: number; device: string };

export const formatHlc = (h: Hlc) => `${String(h.ms).padStart(15, "0")}:${String(h.counter).padStart(5, "0")}:${h.device}`;

export function parseHlc(s: string): Hlc {
  const [ms, counter, ...device] = s.split(":");
  return { ms: Number(ms), counter: Number(counter), device: device.join(":") };
}

export class Clock {
  private last: Hlc;

  constructor(
    readonly device: string,
    last?: string,
    private readonly now: () => number = Date.now,
  ) {
    this.last = last ? parseHlc(last) : { ms: 0, counter: 0, device };
  }

  // A timestamp for a local change, later than anything seen so far.
  tick(): string {
    const wall = this.now();
    this.last = wall > this.last.ms ? { ms: wall, counter: 0, device: this.device } : { ms: this.last.ms, counter: this.last.counter + 1, device: this.device };
    return formatHlc(this.last);
  }

  // Seeing a remote change moves the clock past it.
  receive(remote: string) {
    const r = parseHlc(remote);
    const wall = this.now();
    const ms = Math.max(wall, this.last.ms, r.ms);
    const counter = ms === this.last.ms && ms === r.ms ? Math.max(this.last.counter, r.counter) + 1 : ms === this.last.ms ? this.last.counter + 1 : ms === r.ms ? r.counter + 1 : 0;
    this.last = { ms, counter, device: this.device };
  }

  get current() {
    return formatHlc(this.last);
  }
}
