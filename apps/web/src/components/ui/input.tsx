import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm transition-colors outline-none',
        'placeholder:text-muted-foreground/70',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/25',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
