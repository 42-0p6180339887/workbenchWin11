import type { ReactNode } from "react";
import { Check, ChevronRight, CircleAlert, CircleDashed, CircleX, Info, LoaderCircle, Search } from "lucide-react";

export type Tone = "good" | "warn" | "bad" | "info" | "neutral";

export function Badge({ children, tone = "neutral", dot = false }: { children: ReactNode; tone?: Tone; dot?: boolean }) {
  return <span className={`badge badge-${tone}`}>{dot && <i />}{children}</span>;
}

export function StatusIcon({ status }: { status: "passed" | "warning" | "failed" | "notChecked" | "checking" }) {
  const Icon = status === "passed" ? Check : status === "warning" ? CircleAlert : status === "failed" ? CircleX : status === "checking" ? LoaderCircle : CircleDashed;
  return <span className={`status-icon status-${status}`}><Icon size={16} className={status === "checking" ? "spin" : undefined} /></span>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function SearchBox({ value, onChange, placeholder = "搜索" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="search-box">
      <Search size={16} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

export function EmptyState({ icon, title, detail }: { icon?: ReactNode; title: string; detail: string }) {
  return <div className="empty-state">{icon ?? <Info size={28} />}<strong>{title}</strong><span>{detail}</span></div>;
}

export function SplitView({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return <div className="split-view"><aside className="split-list">{list}</aside><section className="split-detail">{detail}</section></div>;
}

export function SelectRow({ selected, onClick, title, subtitle, leading, trailing }: { selected: boolean; onClick: () => void; title: string; subtitle?: string; leading?: ReactNode; trailing?: ReactNode }) {
  return (
    <button className={`select-row ${selected ? "selected" : ""}`} onClick={onClick}>
      {leading && <span className="select-row-leading">{leading}</span>}
      <span className="select-row-text"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>
      {trailing ?? <ChevronRight size={15} className="row-chevron" />}
    </button>
  );
}

export function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return <section className="detail-block"><h3>{title}</h3><div>{children}</div></section>;
}

export function KeyValue({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return <div className="key-value"><span>{label}</span><strong className={mono ? "mono" : undefined}>{value}</strong></div>;
}

export function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button type="button" className={`toggle ${checked ? "on" : ""}`} disabled={disabled} onClick={() => onChange(!checked)} aria-label={label} aria-pressed={checked}>
      <span />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, disabled, onChange }: { value: T; options: Array<{ value: T; label: string }>; disabled?: boolean; onChange: (value: T) => void }) {
  return <div className="segmented">{options.map((option) => <button key={option.value} disabled={disabled} className={value === option.value ? "active" : ""} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

export function ProgressBar({ value, tone = "info" }: { value: number; tone?: Tone }) {
  return <div className="progress-track"><span className={`progress-fill fill-${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function Metric({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon?: ReactNode }) {
  return <div className="metric-card"><div className="metric-top">{icon}<span>{value}</span></div><strong>{label}</strong>{hint && <small>{hint}</small>}</div>;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatCompact(value?: number): string {
  return value === undefined ? "不可用" : new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatDate(value?: string): string {
  if (!value) return "未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
