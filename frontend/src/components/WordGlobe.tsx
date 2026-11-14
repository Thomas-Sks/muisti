// A turning sphere of article titles in Finnish, Swedish and English, among loose letters; the three editions
// of a topic are joined by threads (what Muisti compares). Built once as DOM elements placed in CSS 3D; the
// rotation is a CSS animation run by the compositor: no JavaScript per frame. Paused on hover so a title can
// be clicked; static when the system asks for reduced motion.
import { useMemo } from "react";
import { Link } from "react-router-dom";

type Lang = "fi" | "sv" | "en";
type V = [number, number, number];

const TOPICS: { qid: string; fi: string; sv: string; en: string }[] = [
  { qid: "Q211855", fi: "Suomen sisällissota", sv: "Finska inbördeskriget", en: "Finnish Civil War" },
  { qid: "Q134949", fi: "Talvisota", sv: "Vinterkriget", en: "Winter War" },
  { qid: "Q122100", fi: "Jatkosota", sv: "Fortsättningskriget", en: "Continuation War" },
  { qid: "Q152306", fi: "Mannerheim", sv: "Mannerheim", en: "Mannerheim" },
  { qid: "Q1412941", fi: "Lapuan liike", sv: "Lapporörelsen", en: "Lapua Movement" },
  { qid: "Q179858", fi: "Urho Kekkonen", sv: "Urho Kekkonen", en: "Urho Kekkonen" },
];
const LETTERS = "AÄÅBDEFGHIJKLMNOÖPRSTUVWYaäåeiklmnoöprstuvy".split("");
const COLORS: Record<Lang, string> = { fi: "#2f5fc4", sv: "#b4570f", en: "#13795b" };
const N = 84;

const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** matrix3d placing an element's plane on the sphere at p, facing outward (y is down, as in CSS). */
function onSphere(p: V, r: number): string {
  const n = p;
  const right = norm(cross([0, 1, 0], n));
  const down = cross(n, right);
  return `matrix3d(${right.join(",")},0,${down.join(",")},0,${n.join(",")},0,${p[0] * r},${p[1] * r},${p[2] * r},1)`;
}

/** matrix3d turning a 1×1 px element into a thread from a to b. */
function thread(a: V, b: V, r: number): string {
  const A: V = [a[0] * r, a[1] * r, a[2] * r], B: V = [b[0] * r, b[1] * r, b[2] * r];
  const d: V = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const len = Math.hypot(...d), u = norm(d);
  const v = norm(cross(u, Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), w = cross(u, v);
  return `matrix3d(${u[0] * len},${u[1] * len},${u[2] * len},0,${v.join(",")},0,${w.join(",")},0,${A.join(",")},1)`;
}

export default function WordGlobe({ size = 440 }: { size?: number }) {
  const R = size * 0.36;
  const { items, links } = useMemo(() => {
    // all Finnish titles, then Swedish, then English: the editions of a topic land far apart
    const words = (["fi", "sv", "en"] as const).flatMap((l) => TOPICS.map((t) => ({ text: t[l], lang: l as Lang, qid: t.qid })));
    const slot = new Map(words.map((w, k) => [Math.floor(((k + 0.5) * N) / words.length), w]));
    const pts = Array.from({ length: N }, (_, i) => {
      const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), phi = i * Math.PI * (3 - Math.sqrt(5));
      const p: V = [Math.cos(phi) * r, y, Math.sin(phi) * r];        // Fibonacci sphere
      const w = slot.get(i);
      return { key: i, p, text: w?.text ?? LETTERS[(i * 7) % LETTERS.length], lang: w?.lang, qid: w?.qid };
    });
    const links = TOPICS.flatMap((t) => {
      const ps = pts.filter((it) => it.qid === t.qid);
      return ps.flatMap((a, i) => ps.slice(i + 1).map((b) => ({ key: `${a.key}-${b.key}`, m: thread(a.p, b.p, R) })));
    });
    return { items: pts.map((it) => ({ ...it, m: onSphere(it.p, R) })), links };
  }, [R]);

  return (
    <div className="word-globe relative" style={{ width: size, height: size }} role="img"
      aria-label="A turning globe of article titles in Finnish, Swedish and English; the three editions of each topic are linked.">
      <div className="absolute rounded-full" style={{
        left: size / 2 - R * 1.05, top: size / 2 - R * 1.05, width: R * 2.1, height: R * 2.1,
        background: "radial-gradient(circle at 35% 30%, #ffffff 0%, #e3e9f7 75%)", border: "1px solid rgba(51,102,204,0.18)",
      }} />
      <div className="absolute inset-0" style={{ perspective: size * 3 }}>
        <div className="absolute left-1/2 top-1/2" style={{ transformStyle: "preserve-3d", transform: "rotateX(-14deg)" }}>
          <div className="word-globe-spin" style={{ transformStyle: "preserve-3d" }}>
            {links.map((l) => (
              <span key={l.key} className="absolute left-0 top-0 block h-px w-px origin-top-left bg-[rgba(51,102,204,0.28)]" style={{ transform: l.m }} />
            ))}
            {items.map((it) => {
              const style = { transform: `${it.m} translate(-50%, -50%)`, backfaceVisibility: "hidden" as const };
              return it.qid ? (
                <Link key={it.key} to={`/topic/${it.qid}`} className="absolute left-0 top-0 whitespace-nowrap text-[13px] font-semibold hover:underline"
                  style={{ ...style, color: COLORS[it.lang!] }}>{it.text}</Link>
              ) : (
                <span key={it.key} className="serif pointer-events-none absolute left-0 top-0 text-[12px] text-[rgba(51,102,204,0.35)]" style={style}>{it.text}</span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
