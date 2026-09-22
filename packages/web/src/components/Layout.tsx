// Szkielet aplikacji: ciemny sidebar (grid 190px 1fr; poniżej 1200 px zwija się do 56 px samym
// CSS — patrz styles/a.css) z sekcjami „Analiza” (Dane/Okno/Okazje/Modele) i „System” (Kolejka
// zadań z liczbą queued+running). `Layout` jest czysty (renderuje się bez
// QueryClientProvider) — dane kolejki dostarcza `AppLayout` (routes.tsx).
import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import type { JobDto } from "@dex-arb/shared";
import { useJobs } from "../api/hooks";

export type LayoutProps = { queueCount?: number | undefined };

export function activeJobsCount(jobs: JobDto[]): number {
  return jobs.filter((j) => j.status === "queued" || j.status === "running").length;
}

// Proste glify SVG (24×24, stroke) — jedyne, co widać po zwinięciu sidebara.
const ICONS: Record<string, ReactNode> = {
  live: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12h4l3-7 4 14 3-7h4" />
    </svg>
  ),
  dane: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </svg>
  ),
  okno: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 17l5-6 4 4 4-7 5 5" />
      <path d="M3 21h18" />
    </svg>
  ),
  okazje: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h11l-3-3" />
      <path d="M20 17H9l3 3" />
    </svg>
  ),
  modele: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M8 11l8-4M8 13l8 4" />
    </svg>
  ),
  kolejka: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="4" rx="1" />
      <rect x="3" y="11" width="18" height="4" rx="1" />
      <rect x="3" y="17" width="12" height="4" rx="1" />
    </svg>
  ),
};

function NavItem({ to, icon, label, count }: { to: string; icon: string; label: string; count?: number | undefined }) {
  return (
    <NavLink to={to} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")} title={label}>
      <span className="nav-icon">{ICONS[icon]}</span>
      <span className="nav-label">{label}</span>
      {count != null && count > 0 && <span className="nav-count">{count}</span>}
    </NavLink>
  );
}

export function Layout({ queueCount }: LayoutProps) {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand" title="dex-arb-analyzer">
          <span className="brand-mark" aria-hidden="true">
            ⟁
          </span>
          <span className="brand-text">dex-arb-analyzer</span>
        </div>
        <nav className="nav-section" aria-label="Analiza">
          <div className="nav-section-title">Analiza</div>
          <NavItem to="/live" icon="live" label="Na żywo" />
          <NavItem to="/dane" icon="dane" label="Dane" />
          <NavItem to="/okno" icon="okno" label="Okno" />
          <NavItem to="/okazje" icon="okazje" label="Okazje" />
          <NavItem to="/modele" icon="modele" label="Modele" />
        </nav>
        <nav className="nav-section" aria-label="System">
          <div className="nav-section-title">System</div>
          <NavItem to="/dane#zadania" icon="kolejka" label="Kolejka zadań" count={queueCount} />
        </nav>
      </aside>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

/** Layout z żywym licznikiem kolejki — używany w routes.tsx (wymaga QueryClientProvider). */
export function AppLayout() {
  const jobs = useJobs();
  return <Layout queueCount={activeJobsCount(jobs.data ?? [])} />;
}
