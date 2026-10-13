import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const alertVariants = cva('relative w-full rounded-lg border px-4 py-3 text-sm', {
  variants: {
    variant: {
      default: 'bg-background text-foreground',
      destructive: 'border-destructive/30 bg-destructive/5 text-destructive',
      success: 'border-success/30 bg-success/5 text-success',
      warning: 'border-warning/40 bg-warning/10 text-warning-foreground',
      info: 'border-info/30 bg-info/5 text-info',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-title" className={cn('mb-1 font-medium', className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('text-sm [&_p]:leading-relaxed', className)}
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertTitle, alertVariants };
