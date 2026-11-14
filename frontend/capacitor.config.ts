import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "tech.stackaxis.guestlog",
  appName: "Gustlog",
  webDir: "dist",
  server: {
    androidScheme: "https",
    // Android blocks plain HTTP. Only dev builds against a local API may use it.
    cleartext: process.env.CAP_DEV === "1",
  },
  android: {
    allowMixedContent: process.env.CAP_DEV === "1",
  },
};

export default config;
