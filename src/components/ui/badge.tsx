/* eslint-disable react-refresh/only-export-components */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 border px-2 py-0.5 text-xs font-semibold',
  {
    variants: {
      variant: {
        default: 'border-border/50 bg-card text-foreground',
        accent: 'border-primary text-primary bg-card',
        muted: 'border-transparent bg-muted text-muted-foreground',
        destructive: 'border-destructive bg-destructive text-white',
        outline: 'border-border/50 bg-transparent text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
