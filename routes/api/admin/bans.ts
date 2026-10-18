import { defineHandler } from 'void';
import { Fame } from '../../../durable-objects/fame';
import { requireAdmin } from './_auth';

const MAX_IP_LENGTH = 64;
const MAX_REASON_LENGTH = 200;

export const GET = defineHandler(requireAdmin, async () => {
  const bans = await Fame.get('global').listBans();
  return { bans };
});

export const POST = defineHandler(requireAdmin, async (c) => {
  const body = await c.req
    .json<{ ip?: unknown; reason?: unknown }>()
    .catch(() => null);
  const ip = typeof body?.ip === 'string' ? body.ip.trim() : '';
  if (!ip || ip.length > MAX_IP_LENGTH) {
    return c.json({ error: 'A valid IP is required' }, 400);
  }
  const reason =
    typeof body?.reason === 'string'
      ? body.reason.trim().slice(0, MAX_REASON_LENGTH)
      : '';

  const ban = await Fame.get('global').ban(ip, reason, 'admin', Date.now());
  return { ban };
});

export const DELETE = defineHandler(requireAdmin, async (c) => {
  const ip = (c.req.query('ip') ?? '').trim();
  if (!ip) return c.json({ error: 'An IP is required' }, 400);
  const removed = await Fame.get('global').unban(ip);
  return { removed };
});
