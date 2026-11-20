import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const srcDir = fileURLToPath(new URL('./src', import.meta.url));
export default {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  serverExternalPackages: ['postgres'],
  env: { NEXT_PUBLIC_APP_VERSION: version, NEXT_PUBLIC_BUILD_COMMIT: process.env.SOURCE_COMMIT ?? '' },
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias, '@': srcDir };
    return config;
  },
};
