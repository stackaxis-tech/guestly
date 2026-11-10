import { isNative } from "../lib/platform";

/** "Powered by StackAxis" credit, shown in the mobile apps. */
export function PoweredBy({ className }: { className?: string }) {
  if (!isNative) return null;
  return <p className={`text-center text-xs text-muted ${className ?? ""}`}>Powered by StackAxis</p>;
}
