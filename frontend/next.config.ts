import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the project root: a stray lockfile higher up (e.g. ~/package-lock.json)
  // otherwise makes Turbopack pick the wrong root, which breaks CSS hot reload.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
