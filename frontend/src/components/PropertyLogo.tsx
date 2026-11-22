import clsx from "clsx";
import { ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { initials } from "../lib/format";

/** A hotel's own logo, falling back to a monogram of its initials in a soft brand tint. */
export function PropertyLogo({ name, url, size = 32, className }: { name: string; url?: string; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const style = { width: size, height: size };
  if (url && !broken) {
    return (
      <img
        src={url}
        alt={`${name} logo`}
        style={style}
        onError={() => setBroken(true)}
        className={clsx("shrink-0 rounded-[28%] border border-line bg-paper object-contain", className)}
      />
    );
  }
  return (
    <span
      style={{ ...style, fontSize: size * 0.38 }}
      className={clsx(
        "flex shrink-0 items-center justify-center rounded-[28%] bg-brand-50 font-display font-bold tracking-tight text-brand-800 ring-1 ring-brand-100 ring-inset",
        className,
      )}
      aria-hidden
    >
      {initials(name) || "G"}
    </span>
  );
}

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const MAX = 1024 * 1024;

/** Validates a chosen logo on the client before upload. Returns an error message or "". */
export function checkLogoFile(f: File): string {
  if (!ACCEPT.includes(f.type)) return "Use a PNG, JPG, or WebP image.";
  if (f.size > MAX) return "Image must be under 1 MB.";
  return "";
}

/**
 * Logo chooser with a live preview. Works as a controlled picker (`file` + `onChange`)
 * so callers decide when to upload.
 */
export function LogoPicker({
  name,
  currentUrl,
  file,
  onChange,
  onRemove,
  error,
  busy,
}: {
  name: string;
  currentUrl?: string;
  file: File | null;
  onChange: (f: File | null) => void;
  onRemove?: () => void;
  error?: string;
  busy?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string>("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const shown = preview || currentUrl;
  const message = localError || error;

  return (
    <div>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className={clsx(
            "group relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-colors",
            message ? "border-danger" : "border-line-strong hover:border-brand-400 hover:bg-brand-50",
          )}
          aria-label={shown ? "Change logo" : "Upload logo"}
        >
          {shown ? (
            <img src={shown} alt="" className="size-full bg-paper object-contain p-1.5" />
          ) : (
            <ImagePlus className="size-6 text-muted group-hover:text-brand-600" aria-hidden />
          )}
        </button>
        <div className="min-w-0 text-sm">
          <p className="font-medium text-ink">{shown ? `${name || "Hotel"} logo` : "Hotel logo"}</p>
          <p className="text-muted">PNG, JPG or WebP · under 1 MB · square works best</p>
          <div className="mt-1.5 flex gap-3">
            <label htmlFor={id} className="cursor-pointer font-semibold text-brand-700 hover:underline">
              {shown ? "Replace" : "Choose image"}
            </label>
            {(file || (currentUrl && onRemove)) && (
              <button
                type="button"
                className="flex items-center gap-1 font-semibold text-danger hover:underline"
                onClick={() => (file ? onChange(null) : onRemove?.())}
              >
                <Trash2 className="size-3.5" aria-hidden /> Remove
              </button>
            )}
          </div>
        </div>
      </div>
      <input
        ref={input}
        id={id}
        type="file"
        accept={ACCEPT.join(",")}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const err = checkLogoFile(f);
          setLocalError(err);
          if (!err) onChange(f);
        }}
      />
      {message && (
        <p className="mt-2 text-[13px] text-danger" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
