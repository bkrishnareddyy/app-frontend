interface PanelHeadingProps {
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  title: string;
  subtitle: string;
  /** Tighter heading for the Manage Account modal, where vertical space is scarce and the nav rail already names the section. */
  compact?: boolean;
}

export function PanelHeading({ icon: Icon, badge, title, subtitle, compact }: PanelHeadingProps) {
  if (compact) {
    return (
      <div>
        <h1 className="text-lg font-bold text-ink tracking-tight">{title}</h1>
        <p className="text-ink-muted text-xs mt-0.5">{subtitle}</p>
      </div>
    );
  }

  return (
    <div>
      {badge && (
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-brand text-xs font-semibold mb-3">
          <Icon className="w-3.5 h-3.5" />
          <span>{badge}</span>
        </div>
      )}
      <h1 className="text-3xl font-extrabold text-ink tracking-tight">{title}</h1>
      <p className="text-ink-muted text-sm mt-1">{subtitle}</p>
    </div>
  );
}
