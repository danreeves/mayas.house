import { defineHandler } from 'void';
import {
  checkPassword,
  clearSessionCookie,
  isSignedIn,
  sessionCookie,
} from './_auth';

/** Whether the browser currently holds a valid admin session. */
export const GET = defineHandler(async (c) => {
  return { signedIn: await isSignedIn(c) };
});

export const POST = defineHandler(async (c) => {
  const body = await c.req
    .json<{ password?: unknown }>()
    .catch(() => null);
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!checkPassword(c, password)) {
    // Slow down guessing; the real defense is a strong password.
    await new Promise((resolve) => setTimeout(resolve, 400));
    return c.json({ error: 'Incorrect password' }, 401);
  }

  return new Response(JSON.stringify({ signedIn: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': await sessionCookie(c),
    },
  });
});

export const DELETE = defineHandler(async (c) => {
  return new Response(JSON.stringify({ signedIn: false }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookie(c),
    },
  });
});
