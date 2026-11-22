import { isNative } from "./platform";

/** Native-only setup. Loaded only inside the Android/iOS app. */
export async function initNative() {
  const { App } = await import("@capacitor/app");
  // Android back button: close the open sheet first, then go back, then leave the app.
  await App.addListener("backButton", ({ canGoBack }) => {
    const open = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
    if (open.length) open[open.length - 1].close();
    else if (canGoBack) window.history.back();
    else void App.exitApp();
  });

  // Dark status-bar icons on our white top bar. On Android the web view sits
  // below the bar instead of under it, so nothing hides behind the clock.
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Light });
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.getPlatform() === "android") {
      await StatusBar.setOverlaysWebView({ overlay: false });
      await StatusBar.setBackgroundColor({ color: "#ffffff" });
    }
  } catch {
    // Status bar styling is cosmetic; never block start-up on it.
  }
}

/** A light tap on the phone's vibration motor. Does nothing in a browser. */
export function haptic(kind: "light" | "medium" = "light") {
  if (!isNative) return;
  void import("@capacitor/haptics")
    .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: kind === "light" ? ImpactStyle.Light : ImpactStyle.Medium }))
    .catch(() => {});
}

/**
 * Marks <html class="kb-open"> while the on-screen keyboard is up, so the
 * bottom nav and floating button step out of the way of the field being typed in.
 * Works in the apps and in mobile browsers (via visualViewport).
 */
export function watchKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => document.documentElement.classList.toggle("kb-open", window.innerHeight - vv.height > 150);
  vv.addEventListener("resize", update);
  update();
}
