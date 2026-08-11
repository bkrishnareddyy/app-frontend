import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-white p-6 md:p-8 rounded-2xl border border-border shadow-[0_4px_24px_-2px_rgba(0,0,0,0.04),0_2px_8px_-2px_rgba(0,0,0,0.02)]",
        className
      )}
      {...props}
    />
  );
}

/** Icon + title/subtitle header with a bottom divider, as used at the top of form cards. */
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("border-b border-border pb-4 mb-6 flex items-center space-x-3", className)}
      {...props}
    />
  );
}

export function CardHeaderIcon({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center shrink-0",
        className
      )}
      {...props}
    />
  );
}
