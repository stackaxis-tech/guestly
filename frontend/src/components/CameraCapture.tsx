import clsx from "clsx";
import { Camera, EyeOff, RefreshCw, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { isNative } from "../lib/platform";
import { Button } from "./ui";

/* ---------- Image helpers ---------- */

const MAX_EDGE = 1600;

// Photos that will be read for details keep the camera's full resolution.
const SCAN_EDGE = 4096;

/** Downscales and re-encodes an image as JPEG so uploads stay small (~150–400 KB). */
export async function compressImage(source: Blob | HTMLCanvasElement, maxEdge = MAX_EDGE, quality = 0.82): Promise<Blob> {
  const isCanvas = source instanceof HTMLCanvasElement;
  const img = isCanvas ? source : await createImageBitmap(source, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (!isCanvas) (img as ImageBitmap).close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process the image."))), "image/jpeg", quality),
  );
}

const canUseLiveCamera = () => typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

/* ---------- Public component ---------- */

type Props = {
  label: string;
  hint?: string;
  facing: "user" | "environment";
  value: Blob | null;
  onChange: (b: Blob | null) => void;
  /** Ask staff to black out part of the image (Aadhaar number) before it's kept. */
  redact?: { instruction: string };
  /** Receives each new photo at full resolution, before any masking, to read the ID's details. */
  onScan?: (src: Blob | HTMLCanvasElement) => void;
  /** The live camera captures by itself as soon as it can read a QR code (Aadhaar). */
  autoQR?: boolean;
  error?: string;
  shape?: "portrait" | "card";
};

export function CameraCapture({ label, hint, facing, value, onChange, redact, onScan, autoQR, error, shape = "card" }: Props) {
  const [preview, setPreview] = useState("");
  const [live, setLive] = useState(false);
  const [toRedact, setToRedact] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const captureInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!value) {
      setPreview("");
      return;
    }
    const u = URL.createObjectURL(value);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [value]);

  const accept = async (raw: Blob | HTMLCanvasElement) => {
    setBusy(true);
    setLocalError("");
    try {
      onScan?.(raw);
      const b = await compressImage(raw);
      if (redact) setToRedact(b);
      else onChange(b);
    } catch {
      setLocalError("Couldn't read that image. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setLocalError("Choose a photo (JPG or PNG).");
      return;
    }
    void accept(f);
  };

  const takeNativePhoto = async () => {
    const { Camera, CameraDirection, CameraResultType, CameraSource } = await import("@capacitor/camera");
    try {
      const photo = await Camera.getPhoto({
        source: CameraSource.Camera,
        resultType: CameraResultType.Uri,
        direction: facing === "user" ? CameraDirection.Front : CameraDirection.Rear,
        quality: 95,
        correctOrientation: true,
        saveToGallery: false,
      });
      if (photo.webPath) await accept(await (await fetch(photo.webPath)).blob());
    } catch (err) {
      // Backing out of the camera isn't an error.
      if (!String(err).toLowerCase().includes("cancel")) setLocalError("Couldn't open the camera. Check camera permission, or use Upload.");
    }
  };

  const takePhoto = () => (isNative ? void takeNativePhoto() : canUseLiveCamera() ? setLive(true) : captureInput.current?.click());
  const message = localError || error;

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink-soft">{label}</p>
      <div
        className={clsx(
          "relative flex items-center justify-center overflow-hidden rounded-xl border-2 border-dashed bg-sand/40",
          shape === "portrait" ? "aspect-[3/4] w-36" : "aspect-[1.586] w-full max-w-xs",
          message ? "border-danger" : value ? "border-transparent" : "border-line-strong",
        )}
      >
        {preview ? (
          <img src={preview} alt={label} className="size-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1 p-3 text-center text-muted">
            <Camera className="size-6" aria-hidden />
            {hint && <span className="text-xs">{hint}</span>}
          </div>
        )}
        {busy && <div className="absolute inset-0 flex items-center justify-center bg-paper/70 text-sm">Processing…</div>}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={value ? "secondary" : "primary"} icon={<Camera className="size-4" />} onClick={takePhoto}>
          {value ? "Retake" : "Take photo"}
        </Button>
        <Button type="button" size="sm" variant="ghost" icon={<Upload className="size-4" />} onClick={() => fileInput.current?.click()}>
          Upload
        </Button>
        {value && (
          <Button type="button" size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => onChange(null)} aria-label={`Remove ${label}`}>
            Remove
          </Button>
        )}
      </div>
      {message && (
        <p className="mt-1.5 text-[13px] text-danger" role="alert">
          {message}
        </p>
      )}
      <input ref={fileInput} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={onFile} />
      {/* On phones without live-camera support (e.g. plain http), this opens the camera app directly. */}
      <input ref={captureInput} type="file" accept="image/*" capture={facing} className="sr-only" tabIndex={-1} onChange={onFile} />

      {live && (
        <LiveCamera
          facing={facing}
          maxEdge={onScan ? SCAN_EDGE : MAX_EDGE}
          autoQR={autoQR}
          onClose={() => setLive(false)}
          onCapture={(c) => {
            setLive(false);
            void accept(c);
          }}
          onUnavailable={() => {
            setLive(false);
            captureInput.current?.click();
          }}
        />
      )}
      {toRedact && redact && (
        <Redactor
          image={toRedact}
          instruction={redact.instruction}
          onCancel={() => setToRedact(null)}
          onDone={(b) => {
            setToRedact(null);
            onChange(b);
          }}
        />
      )}
    </div>
  );
}

/* ---------- Full-screen overlay ---------- */

function Overlay({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onClose={onClose} className="m-0 h-dvh max-h-none w-full max-w-none bg-ink p-0 text-ivory backdrop:bg-ink" aria-label={title}>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
          <p className="font-semibold">{title}</p>
          <button onClick={onClose} className="rounded-md p-2 hover:bg-white/10" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/* ---------- Live camera (getUserMedia) ---------- */

function LiveCamera({
  facing,
  maxEdge,
  autoQR,
  onCapture,
  onClose,
  onUnavailable,
}: {
  facing: "user" | "environment";
  maxEdge: number;
  autoQR?: boolean;
  onCapture: (c: HTMLCanvasElement) => void;
  onClose: () => void;
  onUnavailable: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState(facing);
  const [error, setError] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: mode }, width: { ideal: maxEdge > MAX_EDGE ? 3840 : 1920 }, height: { ideal: maxEdge > MAX_EDGE ? 2160 : 1080 } }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
      })
      .catch((e: DOMException) => {
        if (e.name === "NotAllowedError") setError("Camera access was blocked. Allow the camera in your browser settings, or use Upload.");
        else onUnavailable();
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [mode, maxEdge, onUnavailable]);

  const frame = (): HTMLCanvasElement | null => {
    const v = video.current;
    if (!v || !v.videoWidth) return null;
    const scale = Math.min(1, maxEdge / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    const ctx = c.getContext("2d")!;
    if (mode === "user") {
      // Front cameras show a mirror image; save it the right way round.
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return c;
  };
  const capture = () => {
    const c = frame();
    if (c) onCapture(c);
  };

  // Aadhaar: keep reading frames and take the photo as soon as the QR decodes,
  // so staff don't have to hold a dense QR perfectly still for one shot.
  const [found, setFound] = useState(false);
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;
  useEffect(() => {
    if (!autoQR || mode !== "environment") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const c = frame();
      if (c) {
        const { decodeQR } = await import("../lib/idscan/qr");
        const text = await decodeQR(c, true).catch(() => null);
        if (stopped) return;
        if (text) {
          setFound(true);
          onCaptureRef.current(c);
          return;
        }
      }
      if (!stopped) timer = setTimeout(tick, 350);
    };
    timer = setTimeout(tick, 600);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // frame() reads only refs and state that restart this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoQR, mode]);

  return (
    <Overlay onClose={onClose} title={mode === "user" ? "Guest photo" : "Photograph the ID"}>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
        {error ? (
          <p className="max-w-sm px-6 text-center text-sm">{error}</p>
        ) : (
          <video ref={video} playsInline muted className={clsx("max-h-full max-w-full", mode === "user" && "-scale-x-100")} />
        )}
        {!error && mode === "environment" && (
          <div className="pointer-events-none absolute inset-x-[8%] top-1/2 aspect-[1.586] -translate-y-1/2 rounded-2xl border-2 border-white/70" aria-hidden />
        )}
        {!error && autoQR && mode === "environment" && (
          <p className="absolute inset-x-0 bottom-4 mx-auto w-fit rounded-full bg-black/60 px-4 py-1.5 text-sm" role="status">
            {found ? "QR code read" : "Point at the QR code. It captures by itself, or tap the button."}
          </p>
        )}
      </div>
      <div className="flex items-center justify-center gap-8 px-4 py-5">
        <button
          onClick={() => setMode((m) => (m === "user" ? "environment" : "user"))}
          className="rounded-full p-3 hover:bg-white/10"
          aria-label="Switch camera"
        >
          <RefreshCw className="size-6" />
        </button>
        <button
          onClick={capture}
          disabled={!!error}
          className="size-16 rounded-full border-4 border-white bg-white/20 transition hover:bg-white/40 disabled:opacity-40"
          aria-label="Take photo"
        />
        <span className="size-12" aria-hidden />
      </div>
    </Overlay>
  );
}

/* ---------- Redaction (mask the Aadhaar number) ---------- */

type Rect = { x: number; y: number; w: number; h: number };

function Redactor({ image, instruction, onCancel, onDone }: { image: Blob; instruction: string; onCancel: () => void; onDone: (b: Blob) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
  const [rects, setRects] = useState<Rect[]>([]);
  const [draft, setDraft] = useState<Rect | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let b: ImageBitmap | null = null;
    void createImageBitmap(image).then((x) => {
      b = x;
      setBmp(x);
    });
    return () => b?.close();
  }, [image]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !bmp) return;
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    ctx.fillStyle = "#000";
    for (const r of draft ? [...rects, draft] : rects) ctx.fillRect(r.x, r.y, r.w, r.h);
  }, [bmp, rects, draft]);

  const point = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current!;
    const b = c.getBoundingClientRect();
    return { x: ((e.clientX - b.left) / b.width) * c.width, y: ((e.clientY - b.top) / b.height) * c.height };
  };
  const norm = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  });

  const done = async () => {
    onDone(await compressImage(canvas.current!));
  };

  return (
    <Overlay onClose={onCancel} title="Hide the Aadhaar number">
      <p className="flex items-start gap-2 px-4 pb-3 text-sm text-ivory/80">
        <EyeOff className="mt-0.5 size-4 shrink-0 text-accent-300" aria-hidden />
        {instruction}
      </p>
      <div className="flex flex-1 items-center justify-center overflow-hidden px-4">
        <canvas
          ref={canvas}
          className="max-h-full max-w-full touch-none rounded-lg"
          style={{ cursor: "crosshair" }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            start.current = point(e);
          }}
          onPointerMove={(e) => start.current && setDraft(norm(start.current, point(e)))}
          onPointerUp={(e) => {
            if (start.current) {
              const r = norm(start.current, point(e));
              if (r.w > 8 && r.h > 8) setRects((rs) => [...rs, r]);
            }
            start.current = null;
            setDraft(null);
          }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button variant="ghost" className="text-ivory hover:bg-white/10 hover:text-ivory" icon={<RotateCcw className="size-4" />} disabled={!rects.length} onClick={() => setRects((r) => r.slice(0, -1))}>
          Undo
        </Button>
        <Button variant="ghost" className="text-ivory hover:bg-white/10 hover:text-ivory" onClick={() => onDone(image)}>
          Keep without hiding
        </Button>
        <Button disabled={!rects.length} onClick={done} className="bg-accent-400 text-ink hover:bg-accent-300">
          Save masked photo
        </Button>
      </div>
    </Overlay>
  );
}
