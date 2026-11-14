// Links into Wikipedia and texts an editor needs (attribution, talk-page notes).
import { useEffect, useState } from "react";
import type { Lang } from "./api";

const TALK: Record<Lang, string> = { fi: "Keskustelu", sv: "Diskussion", en: "Talk" };
const LANG_IN: Record<Lang, Record<Lang, string>> = {
  // how each Wikipedia names the *other* languages in an edit summary
  fi: { fi: "suomenkielisestä", sv: "ruotsinkielisestä", en: "englanninkielisestä" },
  sv: { fi: "finskspråkiga", sv: "svenskspråkiga", en: "engelskspråkiga" },
  en: { fi: "Finnish", sv: "Swedish", en: "English" },
};

const base = (lang: Lang) => `https://${lang}.wikipedia.org`;
const enc = (title: string) => encodeURIComponent(title.replace(/ /g, "_"));

export const wiki = {
  read: (lang: Lang, title: string) => `${base(lang)}/wiki/${enc(title)}`,
  edit: (lang: Lang, title: string) => `${base(lang)}/w/index.php?title=${enc(title)}&action=edit`,
  history: (lang: Lang, title: string) => `${base(lang)}/w/index.php?title=${enc(title)}&action=history`,
  talk: (lang: Lang, title: string) => `${base(lang)}/wiki/${enc(`${TALK[lang]}:${title}`)}`,
  oldid: (lang: Lang, rev: number) => `${base(lang)}/?oldid=${rev}`,
  diff: (lang: Lang, rev: number) => `${base(lang)}/?diff=${rev}`,
  section: (lang: Lang, title: string, section: string | null) => {
    const last = section?.split(" › ").pop();
    return last ? `${wiki.read(lang, title)}#${enc(last)}` : wiki.read(lang, title);
  },
  /** Opens the live article scrolled to this sentence, highlighted (URL text fragment; Chromium, Safari, Firefox 131+). */
  sentence: (lang: Lang, title: string, quote: string) => {
    const words = quote.replace(/[“”"]/g, "").trim().split(/\s+/);
    const frag = words.length > 10
      ? `${encodeURIComponent(words.slice(0, 4).join(" "))},${encodeURIComponent(words.slice(-4).join(" "))}`
      : encodeURIComponent(words.join(" "));
    return `${wiki.read(lang, title)}#:~:text=${frag}`;
  },
};

/** Edit summary attributing a translation, as Wikipedia's licence requires (CC BY-SA). */
export function attribution(target: Lang, source: Lang, sourceTitle: string, rev: number): string {
  const link = `[[:${source}:${sourceTitle}]]`;
  if (target === "fi") return `Käännetty ${LANG_IN.fi[source]} Wikipedian artikkelista ${link} (versio ${rev}); tekijät näkyvät sen muutoshistoriasta.`;
  if (target === "sv") return `Innehåll översatt från ${LANG_IN.sv[source]} Wikipedias artikel ${link} (version ${rev}); se dess versionshistorik för upphovspersoner.`;
  return `Content in this edit is translated from the existing ${LANG_IN.en[source]} Wikipedia article at ${link} (revision ${rev}); see its history for attribution.`;
}

/** A neutral talk-page note in wikitext, listing what each edition states, with revision links. */
export function talkNote(heading: string, intro: string, rows: { lang: Lang; title: string; rev: number; quote: string; translation?: string }[]): string {
  const lines = rows.map((r) =>
    `* '''${r.lang}''' – [[:${r.lang}:${r.title}]] ([[:${r.lang}:Special:PermanentLink/${r.rev}|rev ${r.rev}]]): "${r.quote}"${r.translation && r.lang !== "en" ? ` (''${r.translation}'')` : ""}`);
  return `== ${heading} ==\n${intro}\n${lines.join("\n")}\n~~~~`;
}

/** The edition the editor is working on, remembered between visits. */
export function useEditingLang(available: Lang[]): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const v = localStorage.getItem("muisti-editing-lang");
      if (v === "fi" || v === "sv" || v === "en") return v;
    } catch { /* storage unavailable */ }
    return "fi";
  });
  useEffect(() => { try { localStorage.setItem("muisti-editing-lang", lang); } catch { /* ignore */ } }, [lang]);
  const effective = available.includes(lang) ? lang : (available[0] ?? "fi");
  return [effective, setLang];
}

/** Puts my edition first, then the others in fi, sv, en order. */
export function mineFirst(mine: Lang, langs: Lang[]): Lang[] {
  return [mine, ...(["fi", "sv", "en"] as Lang[]).filter((l) => l !== mine && langs.includes(l))].filter((l) => langs.includes(l));
}
