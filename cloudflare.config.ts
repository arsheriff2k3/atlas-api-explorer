import { bindings, defineConfig, defineWorker } from "cf/config";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} for the Cloudflare staging build.`);
  return value;
};

export default defineConfig({
  worker: defineWorker({
    name: "apipassage-staging",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-09-29",
    compatibilityFlags: ["nodejs_compat"],
    assets: { notFoundHandling: "none" },
    env: {
      ASSETS: bindings.assets(),
      CLERK_SECRET_KEY: bindings.secret(),
      NEXT_PUBLIC_CONVEX_URL: bindings.text(required("NEXT_PUBLIC_CONVEX_URL")),
      NEXT_PUBLIC_CONVEX_SITE_URL: bindings.text(required("NEXT_PUBLIC_CONVEX_SITE_URL")),
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: bindings.text(required("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")),
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: bindings.text("/sign-in"),
      NEXT_PUBLIC_CLERK_SIGN_UP_URL: bindings.text("/sign-up"),
    },
  }),
});
