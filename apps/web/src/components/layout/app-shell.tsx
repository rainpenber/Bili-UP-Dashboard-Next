import { Menu } from 'lucide-react';
import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { navItemForPath } from '@/config/navigation';
import { ThemeControls } from '@/components/theme/theme-controls';
import { cn } from '@/lib/utils';

export function AppShell() {
  const location = useLocation();
  const nav = navItemForPath(location.pathname);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-svh w-full bg-background">
      <div className="hidden w-60 shrink-0 md:block">
        <AppSidebar />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="md:hidden"
                aria-label="打开导航菜单"
              >
                <Menu className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" aria-describedby={undefined}>
              <div className="sr-only" id="mobile-nav-title">
                主导航
              </div>
              <AppSidebar onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{nav?.label ?? '页面'}</p>
          </div>
          <ThemeControls className="hidden sm:flex" />
        </header>

        <main className={cn('mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6')}>
          <Outlet context={{ nav }} />
        </main>
      </div>
    </div>
  );
}

export { PageHeader };
