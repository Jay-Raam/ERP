'use client';

import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** "lg" for forms with tables, such as an order's lines. */
  size?: 'default' | 'lg';
}

/** The app's modal: shadcn Dialog (Radix) with the title and description wired up. */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = 'default',
}: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        className={size === 'lg' ? 'max-h-[90vh] overflow-y-auto sm:max-w-4xl' : undefined}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
