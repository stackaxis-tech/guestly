import clsx from "clsx";
import { CalendarDays, ChevronRight, Loader2, Minus, Plus, X } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

/* ---------- Button ---------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap",
        "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60",
        size === "md" ? "h-10 px-4 text-sm" : "h-8 px-3 text-[13px]",
        variant === "primary" && "bg-teal-700 text-ivory hover:bg-teal-800 active:bg-teal-900",
        variant === "secondary" && "border border-line-strong bg-paper text-ink hover:bg-sand",
        variant === "ghost" && "text-ink-soft hover:bg-sand hover:text-ink",
        variant === "danger" && "bg-danger text-white hover:brightness-95",
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* ---------- Form fields ---------- */

type FieldProps = {
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  children: (id: string, describedBy: string | undefined) => ReactNode;
  className?: string;
};

/** Label + control + hint/error, wired up for screen readers. */
export function Field({ label, error, hint, optional, children, className }: FieldProps) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink-soft">
        {label}
        {optional && <span className="ml-1.5 font-normal text-muted">(optional)</span>}
      </label>
      {children(id, error || hint ? msgId : undefined)}
      {error ? (
        <p id={msgId} className="text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const controlBase =
  "w-full rounded-lg border bg-paper px-3 text-[15px] text-ink placeholder:text-muted/70 " +
  "transition-colors focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-500 " +
  "disabled:bg-sand disabled:text-muted";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; prefix?: string }>(
  function Input({ className, invalid, prefix, ...rest }, ref) {
    if (rest.type === "date") {
      // Native date picker, but with our icon instead of the browser's black one.
      return (
        <div className="relative">
          <input
            ref={ref}
            aria-invalid={invalid || undefined}
            className={clsx(controlBase, "date-input h-10 pr-10", invalid ? "border-danger" : "border-line-strong", className)}
            {...rest}
          />
          <CalendarDays className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        </div>
      );
    }
    const input = (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={clsx(controlBase, "h-10", invalid ? "border-danger" : "border-line-strong", prefix && "pl-7", className)}
        {...rest}
      />
    );
    if (!prefix) return input;
    return (
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">{prefix}</span>
        {input}
      </div>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={clsx(controlBase, "min-h-20 py-2", invalid ? "border-danger" : "border-line-strong", className)}
        {...rest}
      />
    );
  },
);

export { Select } from "./Select";

/** − 1 + stepper for small counts (adults, children, quantity). */
export function Stepper({ id, value, onChange, min = 0, max = 20, label }: { id?: string; value: number; onChange: (n: number) => void; min?: number; max?: number; label: string }) {
  const btn = "flex size-10 items-center justify-center text-ink-soft transition-colors hover:bg-sand disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="inline-flex h-10 items-center overflow-hidden rounded-lg border border-line-strong bg-paper">
      <button type="button" className={btn} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} aria-label={`Fewer ${label}`}>
        <Minus className="size-4" />
      </button>
      <output id={id} className="tabular w-10 text-center text-[15px] font-semibold" aria-live="polite">
        {value}
      </output>
      <button type="button" className={btn} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} aria-label={`More ${label}`}>
        <Plus className="size-4" />
      </button>
    </div>
  );
}

/** Branded show/hide section (replaces the browser's ▶ details marker). */
export function Disclosure({ summary, children, className }: { summary: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={clsx("group", className)}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md text-sm font-semibold text-teal-700 hover:text-teal-800 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
        {summary}
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

/* ---------- Surfaces ---------- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={clsx("rounded-[var(--radius-card)] border border-line bg-paper shadow-[var(--shadow-card)]", className)}>
      {children}
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[28px] leading-tight font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-[15px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-teal-50 text-teal-600">{icon}</div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-muted" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger" role="alert">
      <span>{message}</span>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/* ---------- Sheet (slide-over) ---------- */

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={clsx(
        "m-0 ml-auto h-dvh max-h-dvh w-full max-w-md bg-paper p-0 text-ink shadow-[var(--shadow-pop)]",
        "backdrop:bg-ink/30 max-sm:mt-auto max-sm:h-auto max-sm:max-h-[90dvh] max-sm:max-w-none max-sm:rounded-t-2xl",
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-sand hover:text-ink" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
      </div>
    </dialog>
  );
}
