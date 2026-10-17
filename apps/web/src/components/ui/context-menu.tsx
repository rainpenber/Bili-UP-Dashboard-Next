import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import * as React from 'react';
import { cn } from '@/lib/utils';

function ContextMenu({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />;
}

function readDocumentTheme() {
  return {
    dark: document.documentElement.classList.contains('dark'),
    accent: document.documentElement.dataset.accent,
  };
}

function useDocumentTheme() {
  const [theme, setTheme] = React.useState(readDocumentTheme);
  React.useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(readDocumentTheme());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-accent'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  const theme = useDocumentTheme();
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        data-accent={theme.accent}
        data-theme={theme.dark ? 'dark' : 'light'}
        className={cn(
          'z-50 min-w-36 origin-top-left overflow-hidden rounded-md border border-border bg-background p-1 text-sm text-foreground shadow-md',
          theme.dark && 'dark',
          'workflow-menu-in',
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      className={cn(
        'flex cursor-default select-none items-center rounded-sm px-2 py-1.5 outline-none',
        'focus:bg-accent focus:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger };
