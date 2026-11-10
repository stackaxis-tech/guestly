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
}
