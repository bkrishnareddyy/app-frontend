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
  /** Must match the id on the element carrying the dialog title (see ModalHeader). */
  titleId: string;
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
export function Modal({ isOpen, onClose, titleId, closeDisabled, size = "md", className, children }: ModalProps) {
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
          // Capped in height. The shell centres its surface, and a centred flex
          // child taller than its container overflows in both directions at once
          // -- so an uncapped dialog was clipped at the top and the bottom
          // simultaneously with no way to reach either. On a 1080p screen at 100%
          // zoom that put the upload dialog's own submit button off-screen.
          //
          // Capped here rather than per dialog so every caller inherits it, and a
          // dialog that grows later cannot reintroduce the fault.
          //
          // A column layout so a dialog that wraps its middle in ModalBody gets a
          // pinned header and footer with only the body scrolling. `overflow-y-auto`
          // stays as the fallback for dialogs that do not: without it they would be
          // capped and clipped, which is worse than scrolling the whole surface. It
          // costs nothing once ModalBody is present, since the surface itself then
          // never overflows.
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
  titleId: string;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
}

export function ModalHeader({ titleId, title, subtitle, icon, onClose, closeDisabled }: ModalHeaderProps) {
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
            {title}
          </h3>
          {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
        </div>
      </div>
      <button
        onClick={onClose}
        disabled={closeDisabled}
        aria-label="Close dialog"
        className="p-1.5 rounded-full hover:bg-surface-muted text-ink-muted hover:text-ink transition-colors disabled:opacity-40 shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function ModalFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("shrink-0 flex items-center justify-end space-x-3", className)} {...props} />;
}

/**
 * The scrolling middle of a dialog, between a pinned header and footer.
 *
 * Wrap everything that is neither header nor footer. `min-h-0` is what allows it
 * to shrink below its content -- a flex child defaults to its content size and
 * would push the footer out of the capped surface instead of scrolling.
 *
 * Worth knowing before wrapping: this establishes a clipping context, so an
 * absolutely positioned child (an autocomplete list, a popover) is clipped at the
 * body's edge rather than escaping over the dialog. It scrolls into view with its
 * input, but a dropdown that must overflow the dialog needs a portal instead.
 */
export function ModalBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 min-h-0 overflow-y-auto", className)} {...props} />;
}
