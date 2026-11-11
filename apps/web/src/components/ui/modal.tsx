'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}

/** Native <dialog>: focus trap, Escape and backdrop come from the browser. */
export function Modal({ open, onClose, title, description, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-xl border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/40"
    >
      {open ? (
        <div className="max-h-[85dvh] overflow-y-auto p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 id={titleId} className="text-lg font-semibold tracking-tight">
                {title}
              </h2>
              {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
