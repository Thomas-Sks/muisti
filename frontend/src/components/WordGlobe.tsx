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
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let ay = 0.4, ax = -0.25, vy = reduce ? 0 : 0.0035, drag: { x: number; y: number } | null = null, hover: Item | null = null;
    let raf = 0, placed: { it: Item; sx: number; sy: number; w: number; h: number; z: number }[] = [];
    const R = size * 0.33, cx = size / 2, cy = size / 2;

    const project = (it: Item) => {
      const cosY = Math.cos(ay), sinY = Math.sin(ay), cosX = Math.cos(ax), sinX = Math.sin(ax);
      const x1 = it.x * cosY - it.z * sinY, z1 = it.x * sinY + it.z * cosY;
      const y2 = it.y * cosX - z1 * sinX, z2 = it.y * sinX + z1 * cosX;
      const k = 2.6 / (2.6 + z2);                               // perspective
      return { sx: cx + x1 * R * k, sy: cy + y2 * R * k, z: z2, k };
    };

    const draw = () => {
      ctx.clearRect(0, 0, size, size);
      // the globe: soft disc, outline, a few meridians
      const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R * 1.05);
      g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#e3e9f7");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.04, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(51,102,204,0.18)"; ctx.lineWidth = 1; ctx.stroke();
      for (let m = 0; m < 6; m++) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(Math.cos(ay + (m * Math.PI) / 6)) * R * 1.04, R * 1.04, 0, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(51,102,204,0.07)"; ctx.stroke();
      }
      const pts = items.map((it) => ({ it, ...project(it) }));
      // threads between the three editions of each topic (front ones stronger)
      for (const t of TOPICS) {
        const ps = pts.filter((p) => p.it.qid === t.qid);
        for (let a = 0; a < ps.length; a++) for (let b = a + 1; b < ps.length; b++) {
          const front = (2 - ps[a].z - ps[b].z) / 4;
          ctx.strokeStyle = `rgba(51,102,204,${0.08 + 0.3 * front * (hover?.qid === t.qid ? 2.5 : 1)})`;
          ctx.lineWidth = hover?.qid === t.qid ? 1.6 : 1;
          ctx.beginPath(); ctx.moveTo(ps[a].sx, ps[a].sy); ctx.lineTo(ps[b].sx, ps[b].sy); ctx.stroke();
        }
      }
      placed = [];
      for (const p of pts.sort((a, b) => b.z - a.z)) {            // back to front
        const depth = (1 - p.z) / 2;                               // 0 back .. 1 front
        const word = !!p.it.lang;
        const fs = (word ? 13 : 12) * p.k;
        ctx.font = `${word ? 600 : 400} ${fs}px ${word ? "Inter, sans-serif" : "'Source Serif 4', serif"}`;
        const alpha = word ? 0.25 + 0.75 * depth : 0.08 + 0.3 * depth;
        const hot = hover && hover.qid && hover.qid === p.it.qid;
        ctx.fillStyle = word ? COLORS[p.it.lang!] : "#3366cc";
        ctx.globalAlpha = hot ? 1 : alpha;
        const w = ctx.measureText(p.it.text).width;
        ctx.fillText(p.it.text, p.sx - w / 2, p.sy + fs / 3);
        ctx.globalAlpha = 1;
        if (word && depth > 0.45) placed.push({ it: p.it, sx: p.sx - w / 2, sy: p.sy - fs / 2, w, h: fs, z: p.z });
      }
      if (!drag) ay += vy;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const at = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      return placed.filter((p) => x >= p.sx - 4 && x <= p.sx + p.w + 4 && y >= p.sy - 4 && y <= p.sy + p.h + 4).sort((a, b) => a.z - b.z)[0]?.it ?? null;
    };
    let moved = false;
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY }; moved = false; cv.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        ay += dx * 0.008; ax = Math.max(-1.2, Math.min(1.2, ax + dy * 0.008));
        drag = { x: e.clientX, y: e.clientY };
      } else {
        hover = at(e);
        cv.style.cursor = hover ? "pointer" : "grab";
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
    cv.addEventListener("pointerleave", () => { hover = null; });
    return () => { cancelAnimationFrame(raf); cv.removeEventListener("pointerdown", down); cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerup", up); };
  }, [size, nav]);

  return <canvas ref={ref} style={{ width: size, height: size }} className="touch-none select-none" role="img"
    aria-label="A turning globe of article titles in Finnish, Swedish and English; the three editions of each topic are linked. Click a title to open the topic." />;
}
