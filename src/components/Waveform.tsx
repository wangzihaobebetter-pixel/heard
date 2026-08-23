/**
 * Waveform — canvas bars for the player track and the Library minis.
 *
 * Colour roles come from the live CSS tokens at draw time so both themes work
 * without a re-render: unplayed bars are muted ink, played bars are gold (the
 * shape of sound), and the pressed span's region is the tape accent while it
 * is armed. With no peaks yet (still decoding, or decode failed) it draws
 * nothing — the track's plain line underneath stays visible, which is the
 * designed degradation, not an error.
 */
import { useEffect, useRef } from 'react';

export interface WaveformProps {
  peaks: Float32Array | null;
  /** 0..1 of the recording already played; minis pass 0 for an all-muted shape */
  progress: number;
  /** armed span as fractions of the whole recording */
  span?: { from: number; to: number } | null;
  className?: string;
}

function cssVar(el: HTMLElement, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

export default function Waveform({ peaks, progress, span, className }: WaveformProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!peaks || peaks.length === 0) return;

      const muted = cssVar(canvas, '--ink-3') || '#837A6C';
      const played = cssVar(canvas, '--gold') || '#E8B84B';
      const accent = cssVar(canvas, '--anchor') || '#FF6B35';

      // Bars are sized to the surface, not to the data: ~3 px bars with 2 px
      // gaps read as a waveform; stuffing all buckets in becomes a comb.
      const n = Math.max(24, Math.min(peaks.length, Math.floor(w / 5)));
      const gap = 2;
      const bw = Math.max(2, (w - gap * (n - 1)) / n);
      const step = bw + gap;
      const mid = h / 2;
      const per = peaks.length / n;
      for (let i = 0; i < n; i++) {
        let v = 0;
        const from = Math.floor(i * per);
        const to = Math.max(from + 1, Math.floor((i + 1) * per));
        for (let j = from; j < to && j < peaks.length; j++) if (peaks[j] > v) v = peaks[j];
        const frac = n === 1 ? 0 : i / (n - 1);
        const inSpan = span && frac >= span.from && frac <= span.to;
        ctx.fillStyle = inSpan ? accent : frac <= progress ? played : muted;
        ctx.globalAlpha = inSpan ? 1 : frac <= progress ? 0.95 : 0.5;
        // Perceptual lift: keep a floor so silence still draws a grain, and a
        // gentle curve so mid-loudness bars don't all read identical.
        const bh = Math.max(2, (0.12 + 0.88 * Math.pow(v, 1.25)) * (h - 2));
        const x = i * step;
        const r = Math.min(bw / 2, 1.5);
        ctx.beginPath();
        ctx.roundRect(x, mid - bh / 2, bw, bh, r);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [peaks, progress, span?.from, span?.to]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
