import { NavLink } from 'react-router-dom';
import { primaryNav } from '@/config/navigation';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <aside className="flex h-full flex-col border-r border-sidebar-border bg-sidebar">
      <div className="border-b border-sidebar-border px-4 py-4">
        <p className="text-base font-semibold tracking-tight text-sidebar-foreground">
          工作室运营台
        </p>
        <p className="mt-1 text-xs text-muted-foreground">商单、进度、账号数据</p>
      </div>
      <nav className="flex-1 space-y-1 p-3" aria-label="主导航">
        {primaryNav.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-200',
                  'hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'bg-sidebar-accent font-medium text-foreground'
                    : 'text-sidebar-foreground',
                )
              }
            >
              <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {!item.implemented ? (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  规划中
                </Badge>
              ) : null}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
