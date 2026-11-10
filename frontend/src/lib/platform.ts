import { Capacitor } from "@capacitor/core";

/** True inside the Android/iOS app, false in a browser. */
export const isNative = Capacitor.isNativePlatform();
