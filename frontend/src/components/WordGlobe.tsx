// A slowly turning sphere of article titles in Finnish, Swedish and English, among loose letters. The three
// editions of a topic are joined by thin threads: what Muisti compares. Drag to turn, click a title to open it.
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

type Item = { text: string; lang?: "fi" | "sv" | "en"; qid?: string; x: number; y: number; z: number };

const TOPICS: { qid: string; fi: string; sv: string; en: string }[] = [
  { qid: "Q211855", fi: "Suomen sisällissota", sv: "Finska inbördeskriget", en: "Finnish Civil War" },
  { qid: "Q134949", fi: "Talvisota", sv: "Vinterkriget", en: "Winter War" },
  { qid: "Q122100", fi: "Jatkosota", sv: "Fortsättningskriget", en: "Continuation War" },
  { qid: "Q152306", fi: "Mannerheim", sv: "Mannerheim", en: "Mannerheim" },
  { qid: "Q1412941", fi: "Lapuan liike", sv: "Lapporörelsen", en: "Lapua Movement" },
  { qid: "Q179858", fi: "Urho Kekkonen", sv: "Urho Kekkonen", en: "Urho Kekkonen" },
];
const LETTERS = "AÄÅBDEFGHIJKLMNOÖPRSTUVWYaäåeiklmnoöprstuvy".split("");
const COLORS = { fi: "#2f5fc4", sv: "#b4570f", en: "#13795b" } as const;

function build(): Item[] {
  // all Finnish titles, then Swedish, then English: the editions of one topic land far apart on the globe
  const words = (["fi", "sv", "en"] as const).flatMap((l) => TOPICS.map((t) => ({ text: t[l], lang: l, qid: t.qid })));
  const n = 96;
  // spread the titles evenly among the points, letters elsewhere
  const at = new Map(words.map((w, k) => [Math.floor(((k + 0.5) * n) / words.length), w]));
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / n;                       // Fibonacci sphere
    const r = Math.sqrt(1 - y * y), phi = i * Math.PI * (3 - Math.sqrt(5));
    const w = at.get(i);
    return { text: w ? w.text : LETTERS[(i * 7) % LETTERS.length], lang: w?.lang, qid: w?.qid, x: Math.cos(phi) * r, y, z: Math.sin(phi) * r };
  });
}

export default function WordGlobe({ size = 380 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const nav = useNavigate();

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size * dpr; cv.height = size * dpr; ctx.scale(dpr, dpr);
    const items = build();
    const n = items.length;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let ay = 0.4, ax = -0.25, drag: { x: number; y: number } | null = null, hover: Item | null = null;
    const vy = reduce ? 0 : 0.00021;                                 // radians per millisecond: one turn in ~30 s, whatever the frame rate
    let raf = 0, last = 0, dirty = true, visible = true;
    const R = size * 0.33, cx = size / 2, cy = size / 2;

    // Everything is allocated once: the animation loop creates no objects (nothing for the garbage collector).
    const bg = document.createElement("canvas");                     // static disc, drawn once
    bg.width = size * dpr; bg.height = size * dpr;
    const b = bg.getContext("2d")!;
    b.scale(dpr, dpr);
    const g = b.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R * 1.05);
    g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#e3e9f7");
    b.fillStyle = g; b.beginPath(); b.arc(cx, cy, R * 1.04, 0, Math.PI * 2); b.fill();
    b.strokeStyle = "rgba(51,102,204,0.18)"; b.lineWidth = 1; b.stroke();

    const sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n), sk = new Float32Array(n);
    const order = new Int32Array(n).map((_, i) => i);
    const sortByDepth = () => {                                    // insertion sort in place: no allocation, and
      for (let a = 1; a < n; a++) {                                 // near O(n) since the order barely changes per frame
        const v = order[a], z = sz[v];
        let b = a - 1;
        while (b >= 0 && sz[order[b]] < z) { order[b + 1] = order[b]; b--; }
        order[b + 1] = v;
      }
    };
    const isWord = items.map((it) => !!it.lang);
    // Each word is drawn once into its own small bitmap (at 2x, for sharpness when it comes to the front);
    // the loop only moves and scales these bitmaps: no text layout per frame.
    const SCALE = 2 * dpr;
    const sprites = items.map((it, i) => {
      const px = isWord[i] ? 13 : 12;
      const f = isWord[i] ? `600 ${px}px Inter, sans-serif` : `400 ${px}px 'Source Serif 4', serif`;
      ctx.font = f;
      const w = Math.ceil(ctx.measureText(it.text).width) + 2, h = Math.ceil(px * 1.4);
      const c = document.createElement("canvas");
      c.width = w * SCALE; c.height = h * SCALE;
      const x = c.getContext("2d")!;
      x.scale(SCALE, SCALE); x.font = f; x.textBaseline = "middle";
      x.fillStyle = isWord[i] ? COLORS[it.lang!] : "#3366cc";
      x.fillText(it.text, 1, h / 2);
      return { c, w, h };
    });
    const threadColor = Array.from({ length: 21 }, (_, q) => `rgba(51,102,204,${(q / 20).toFixed(2)})`);
    const triples = TOPICS.map((t) => items.map((it, i) => (it.qid === t.qid ? i : -1)).filter((i) => i >= 0));
    const placedIdx = new Int32Array(n), placedX = new Float32Array(n), placedY = new Float32Array(n), placedW = new Float32Array(n), placedH = new Float32Array(n);
    let placedN = 0;

    const project = () => {
      const cosY = Math.cos(ay), sinY = Math.sin(ay), cosX = Math.cos(ax), sinX = Math.sin(ax);
      for (let i = 0; i < n; i++) {
        const it = items[i];
        const x1 = it.x * cosY - it.z * sinY, z1 = it.x * sinY + it.z * cosY;
        const y2 = it.y * cosX - z1 * sinX, z2 = it.y * sinX + z1 * cosX;
        const k = 2.6 / (2.6 + z2);                              // perspective
        sx[i] = cx + x1 * R * k; sy[i] = cy + y2 * R * k; sz[i] = z2; sk[i] = k;
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(bg, 0, 0, size, size);
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(51,102,204,0.07)";
      for (let m = 0; m < 6; m++) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(Math.cos(ay + (m * Math.PI) / 6)) * R * 1.04, R * 1.04, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      project();
      for (let t = 0; t < triples.length; t++) {                  // threads between the editions of a topic
        const ps = triples[t], hot = hover?.qid === TOPICS[t].qid;
        for (let a = 0; a < ps.length; a++) for (let c = a + 1; c < ps.length; c++) {
          const front = (2 - sz[ps[a]] - sz[ps[c]]) / 4;
          ctx.strokeStyle = threadColor[Math.round(Math.min(1, 0.08 + 0.3 * front * (hot ? 2.5 : 1)) * 20)];
          ctx.lineWidth = hot ? 1.6 : 1;
          ctx.beginPath(); ctx.moveTo(sx[ps[a]], sy[ps[a]]); ctx.lineTo(sx[ps[c]], sy[ps[c]]); ctx.stroke();
        }
      }
      sortByDepth();                                                // back to front
      placedN = 0;
      for (let o = 0; o < n; o++) {
        const i = order[o], it = items[i], word = isWord[i];
        const depth = (1 - sz[i]) / 2;                             // 0 back .. 1 front
        const sp = sprites[i], w = sp.w * sk[i], h = sp.h * sk[i];
        ctx.globalAlpha = hover && hover.qid === it.qid ? 1 : word ? 0.25 + 0.75 * depth : 0.08 + 0.3 * depth;
        ctx.drawImage(sp.c, sx[i] - w / 2, sy[i] - h / 2, w, h);
        if (word && depth > 0.45) {
          placedIdx[placedN] = i; placedX[placedN] = sx[i] - w / 2; placedY[placedN] = sy[i] - h / 2; placedW[placedN] = w; placedH[placedN] = h; placedN++;
        }
      }
      ctx.globalAlpha = 1;
    };

    const loop = (t: number) => {
      raf = 0;
      if (!visible) { last = 0; return; }                           // restarted when the globe scrolls back into view
      const dt = last ? Math.min(t - last, 100) : 0;               // time-based: constant speed; capped after a pause
      if (dt >= 15 || !last) {                                      // at most ~60 redraws per second, even on 144 Hz screens
        last = t;
        if (!drag && vy) { ay += vy * dt; dirty = true; }
        if (dirty) { draw(); dirty = false; }
      }
      if (vy || drag || dirty) raf = requestAnimationFrame(loop);
    };
    const kick = () => { dirty = true; if (!raf && visible) raf = requestAnimationFrame(loop); };
    kick();
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); });
    io.observe(cv);

    const at = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      let best = -1;
      for (let q = 0; q < placedN; q++) {
        if (x >= placedX[q] - 4 && x <= placedX[q] + placedW[q] + 4 && y >= placedY[q] - 4 && y <= placedY[q] + placedH[q] + 4
            && (best < 0 || sz[placedIdx[q]] < sz[placedIdx[best]])) best = q;
      }
      return best < 0 ? null : items[placedIdx[best]];
    };
    let moved = false;
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY }; moved = false; cv.setPointerCapture(e.pointerId); kick(); };
    const move = (e: PointerEvent) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        ay += dx * 0.008; ax = Math.max(-1.2, Math.min(1.2, ax + dy * 0.008));
        drag.x = e.clientX; drag.y = e.clientY;
        kick();
      } else {
        const h = at(e);
        if (h?.qid !== hover?.qid) { hover = h; kick(); }
        cv.style.cursor = h ? "pointer" : "grab";
      }
    };
    const up = (e: PointerEvent) => {
      const hit = !moved ? at(e) : null;
      drag = null;
      if (hit?.qid) nav(`/topic/${hit.qid}`);
    };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    const leave = () => { if (hover) { hover = null; kick(); } };
    cv.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf); io.disconnect();
      cv.removeEventListener("pointerdown", down); cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up); cv.removeEventListener("pointerleave", leave);
    };
  }, [size, nav]);

  return <canvas ref={ref} style={{ width: size, height: size }} className="touch-none select-none" role="img"
    aria-label="A turning globe of article titles in Finnish, Swedish and English; the three editions of each topic are linked. Click a title to open the topic." />;
}
