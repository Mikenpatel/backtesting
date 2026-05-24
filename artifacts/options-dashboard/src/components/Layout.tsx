import { Link, useLocation } from "wouter";
import { LayoutDashboard, TrendingUp, BarChart2, Plus, FileText, Layers } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trades", label: "Trades", icon: TrendingUp },
  { href: "/chain-builder", label: "Strategy Builder", icon: Layers },
  { href: "/market", label: "Market", icon: BarChart2 },
  { href: "/pnl", label: "P&L Statement", icon: FileText },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <aside className="w-56 flex-shrink-0 flex flex-col bg-sidebar border-r border-sidebar-border">
        <div className="px-4 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
              <span className="text-primary-foreground text-xs font-bold">OT</span>
            </div>
            <div>
              <div className="text-sm font-semibold text-sidebar-foreground">Options Trader</div>
              <div className="text-xs text-muted-foreground">NSE Paper Trading</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.href === "/" ? location === "/" : location.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon size={15} className={isActive ? "text-primary" : "text-muted-foreground"} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-2 py-3 border-t border-sidebar-border">
          <Link
            href="/trades/new"
            className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={14} />
            New Trade
          </Link>
        </div>

        <div className="px-4 py-3 border-t border-sidebar-border">
          <div className="text-xs text-muted-foreground">NSE &amp; BSE Market Hours</div>
          <div className="text-xs font-mono-num text-sidebar-foreground mt-0.5">09:15 – 15:30 IST</div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
