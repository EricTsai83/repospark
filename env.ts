import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export function validateBuildEnv() {
  return createEnv({
    clientPrefix: 'VITE_',
    client: {
      VITE_CONVEX_URL: z.string().url(),
      VITE_WORKOS_CLIENT_ID: z.string().min(1),
      VITE_WORKOS_REDIRECT_URI: z.string().url(),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
  });
}
