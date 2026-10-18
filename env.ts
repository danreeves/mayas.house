import { defineEnv, string } from 'void/env';

/**
 * Server environment.
 *
 * ADMIN_PASSWORD gates the /admin moderation panel. Set it as a Worker secret
 * for deploys (`npx wrangler secret put ADMIN_PASSWORD`) and in the git-ignored
 * `.env` for local development. While it is unset, the panel stays locked.
 */
export default defineEnv({
  ADMIN_PASSWORD: string().optional(),
});
