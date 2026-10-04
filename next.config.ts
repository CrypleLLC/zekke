import type { NextConfig } from "next";
import { getBaseUrl } from "./src/lib/api/client";
import { getBillingUrl } from "./src/lib/billing/url";
import {
  objectStoreUrlsFrom,
  requireObjectStoreOrigins,
  securityHeaders,
} from "./src/lib/security-headers";

const buildId =
  process.env.ZEKKE_BUILD_ID?.trim() ||
  process.env.VERCEL_DEPLOYMENT_ID?.trim() ||
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
process.env.ZEKKE_BUILD_ID = buildId;

const nextConfig: NextConfig = {
  generateBuildId: async () => buildId,
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
  async headers() {
    const development = process.env.NODE_ENV !== "production";
    const objectStoreUrls = objectStoreUrlsFrom(process.env.CSP_OBJECT_STORE_ORIGINS);

    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          apiUrl: getBaseUrl(),
          billingUrl: getBillingUrl(),
          objectStoreUrls: development ? objectStoreUrls : requireObjectStoreOrigins(objectStoreUrls),
          development,
        }),
      },
    ];
  },
};

export default nextConfig;
