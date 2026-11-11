import { useId, type ComponentProps, type ReactNode } from 'react';
import { Input } from './input';
import { Label } from './label';

interface FieldProps extends ComponentProps<typeof Input> {
  label: string;
  error?: string;
  hint?: ReactNode;
  /** Rendered inside the input's right edge, e.g. a show-password button. */
  trailing?: ReactNode;
}

/** Label, input, hint and error wired together for screen readers. */
function Field({ label, error, hint, trailing, id, className, ...props }: FieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="relative">
        <Input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}
          className={trailing ? `pr-10 ${className ?? ''}` : className}
          {...props}
        />
        {trailing ? (
          <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export { Field };
