import { defineConfig } from 'void/config';

export default defineConfig({
  target: 'cloudflare',
  head: {
    title: "Maya's House — MapleStory Web Chat",
    htmlAttrs: { lang: 'en' },
    meta: [
      { charset: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no' },
      { name: 'description', content: "Hang out and chat in Maya's House (Henesys 100000001) with custom maples.im characters." },
    ],
  },
  routing: {
    headers: {
      '/api/maple/*': [
        'Cache-Control: public, max-age=31536000, s-maxage=31536000, immutable',
      ],
    },
  },
  worker: {
    compatibility_date: '2026-02-24',
    compatibility_flags: ['nodejs_compat'],
  },
  cloudflare: {
    name: 'mayas-house',
    // Custom domain: Cloudflare creates the DNS record and TLS certificate for
    // the zone pinned to this account. `void domain add mayas.house` writes the
    // same route into the generated .void-wrangler.jsonc.
    routes: [{ pattern: 'mayas.house', custom_domain: true }],
    // No workers.dev fallback: a second public hostname would expose the
    // password-gated /admin API outside the custom domain.
    workers_dev: false,
  },
});
