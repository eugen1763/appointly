import type { NextConfig } from "next";

const configuredAppUrl = process.env.APP_URL;
const allowedDevOrigins = configuredAppUrl
  ? [new URL(configuredAppUrl).hostname]
  : undefined;

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins,
  experimental: {
    useTypeScriptCli: true,
  },
};

export default nextConfig;
