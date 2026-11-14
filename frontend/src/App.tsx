import { useEffect } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import clsx from "clsx";
import SearchPage from "./pages/SearchPage";
import HomePage from "./pages/HomePage";
import TopicPage from "./pages/TopicPage";
import TimeMachinePage from "./pages/TimeMachinePage";
import RadarPage from "./pages/RadarPage";
import LanguagesPage from "./pages/LanguagesPage";
import CheckPage from "./pages/CheckPage";
import AboutPage from "./pages/AboutPage";

const NAV = [
  { to: "/", label: "Topics", end: true },
  { to: "/ask", label: "Ask", end: false },
  { to: "/about", label: "How it works", end: false },
];

export default function App() {
  useEffect(() => { document.documentElement.dataset.theme = "light"; }, []);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-surface-1">
        <div className="mx-auto flex h-12 max-w-7xl items-center gap-8 px-4 sm:px-6">
          <NavLink to="/" className="flex items-baseline gap-2">
            <span className="serif text-[19px] font-semibold text-ink-strong">Muisti</span>
            <span className="hidden text-xs text-ink-3 sm:inline">for Wikipedia editors</span>
          </NavLink>
          <nav className="flex h-full items-stretch gap-5">
            {NAV.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end}
                className={({ isActive }) => clsx("flex items-center border-b-2 text-sm transition-colors",
                  isActive ? "border-accent font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink")}>
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/ask" element={<SearchPage />} />
          <Route path="/topic/:qid" element={<TopicPage />} />
          <Route path="/time" element={<TimeMachinePage />} />
          <Route path="/time/:pageId" element={<TimeMachinePage />} />
          <Route path="/radar" element={<RadarPage />} />
          <Route path="/languages" element={<LanguagesPage />} />
          <Route path="/languages/:qid" element={<LanguagesPage />} />
          <Route path="/check" element={<CheckPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="border-t border-line bg-surface-1">
        <div className="mx-auto max-w-7xl px-4 py-3 text-xs text-ink-3 sm:px-6">
          Text from Finnish, Swedish and English Wikipedia, CC BY-SA 4.0. Every finding links to the revision it comes from. Built on MariaDB 12.3.
        </div>
      </footer>
    </div>
  );
}
