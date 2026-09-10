import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";

export type ToastKind = "success" | "error" | "info";

export function Toast(props: {
  message: string;
  kind: ToastKind;
  onDismiss: () => void;
  durationMs?: number;
}) {
  const { message, kind, onDismiss, durationMs = 4000 } = props;
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    // Two rAFs so the initial (off-screen) state actually paints before the
    // transition to `entered` kicks in — a single setState on mount can get
    // batched into the same frame and skip the animation entirely.
    const raf1 = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
    const t = setTimeout(onDismiss, durationMs);
    return () => {
      cancelAnimationFrame(raf1);
      clearTimeout(t);
    };
  }, [onDismiss, durationMs]);

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto w-80 rounded-lg border px-4 py-3 text-sm shadow-lg transition-all duration-300 ease-out",
        entered ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
        kind === "success" && "border-green-600/30 bg-green-50 text-green-900",
        kind === "error" && "border-destructive/30 bg-destructive/10 text-destructive",
        kind === "info" && "border-border bg-background text-foreground"
      )}
    >
      {message}
    </div>
  );
}

export function ToastStack(props: {
  toasts: { id: number; message: string; kind: ToastKind }[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {props.toasts.map((t) => (
        <Toast key={t.id} message={t.message} kind={t.kind} onDismiss={() => props.onDismiss(t.id)} />
      ))}
    </div>
  );
}
