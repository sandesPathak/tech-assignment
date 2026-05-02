/** @type {import('next').NextConfig} */
const path = require('path');

const baseConfig = {
  reactStrictMode: true,
  // Workspaces / monorepo: transpile shared packages.
  transpilePackages: ['@hijack/protocol'],
  experimental: {
    // Allow Next to follow workspace symlinks during build.
    externalDir: true,
  },
};

// next-pwa is optional — only enable in production builds. The dev path
// avoids touching the service worker so HMR works.
let withPWA;
try {
  // eslint-disable-next-line global-require
  withPWA = require('next-pwa')({
    dest: 'public',
    disable: process.env.NODE_ENV === 'development',
    register: true,
    skipWaiting: true,
  });
} catch (_e) {
  withPWA = (cfg) => cfg;
}

module.exports = withPWA(baseConfig);
