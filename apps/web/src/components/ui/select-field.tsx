import { useId, type ComponentProps } from 'react';
import { Label } from './label';

interface SelectFieldProps extends ComponentProps<'select'> {
  label: string;
  error?: string;
}

export function SelectField({ label, error, id, className, children, ...props }: SelectFieldProps) {
  const generated = useId();
  const selectId = id ?? generated;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={selectId}>{label}</Label>
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${selectId}-error` : undefined}
        className={
          'h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 aria-invalid:border-destructive ' +
          (className ?? '')
        }
        {...props}
      >
        {children}
      </select>
      {error ? (
        <p id={`${selectId}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
