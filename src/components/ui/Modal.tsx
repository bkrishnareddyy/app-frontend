"use client";

import * as React from "react";
import { X } from "lucide-react";
import { useDialogFocus, dialogSurfaceProps } from "@/lib/useDialogFocus";
import { cn } from "@/lib/utils";

const sizeClasses = {
  md: "max-w-lg",
  lg: "max-w-4xl",
  xl: "max-w-5xl",
} as const;

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Matches the id on the element carrying the dialog title. Defaults for legacy callers. */
  titleId?: string;
  /** Disables click-outside and Escape-to-close, e.g. while a submit is in flight. */
  closeDisabled?: boolean;
  size?: keyof typeof sizeClasses;
  className?: string;
  children: React.ReactNode;
}

/**
 * Centered dialog shell: backdrop, focus trap, and Escape/click-outside close
 * via useDialogFocus. Defaults to `space-y-5` between children so header/body/
 * footer sections stack with the same rhythm every dialog in the app already
 * used by hand — pass className to override for a flex-col/custom layout.
 */
export function Modal({ isOpen, onClose, titleId = "modal-title", closeDisabled, size = "md", className, children }: ModalProps) {
  const dialogRef = useDialogFocus<HTMLDivElement>(isOpen, () => {
    if (!closeDisabled) onClose();
  });

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !closeDisabled) onClose();
      }}
    >
      <div
        ref={dialogRef}
        {...dialogSurfaceProps(titleId)}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "bg-white rounded-3xl border border-border shadow-2xl w-full p-6 space-y-5 max-h-[90vh] flex flex-col overflow-y-auto animate-in fade-in zoom-in-95 duration-200",
          sizeClasses[size],
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

export interface ModalHeaderProps {
  titleId?: string;
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onClose?: () => void;
  closeDisabled?: boolean;
  children?: React.ReactNode;
}

export function ModalHeader({
  titleId = "modal-title",
  title,
  subtitle,
  icon,
  onClose,
  closeDisabled,
  children,
}: ModalHeaderProps) {
  if (!title && !subtitle && !icon && !onClose && children) {
    return <div id={titleId} className="shrink-0 border-b border-border pb-3">{children}</div>;
  }

  return (
    <div className="shrink-0 flex items-center justify-between border-b border-border pb-3">
      <div className="flex items-center space-x-2.5 min-w-0">
        {icon && (
          <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-brand shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h3 id={titleId} className="text-base font-extrabold text-ink truncate">
            {title ?? ""}
          </h3>
          {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
        </div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          disabled={closeDisabled}
          aria-label="Close dialog"
          className="p-1.5 rounded-full hover:bg-surface-muted text-ink-muted hover:text-ink transition-colors disabled:opacity-40 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export function ModalFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("shrink-0 flex items-center justify-end space-x-3", className)} {...props} />;
}

export function ModalBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 min-h-0 overflow-y-auto", className)} {...props} />;
}
