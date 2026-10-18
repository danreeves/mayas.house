import { defineHandler } from 'void';
import { Fame } from '../../../durable-objects/fame';
import { requireAdmin } from './_auth';

/** Newest reports first; the panel is a triage list, not an archive. */
const REPORT_PAGE_SIZE = 100;

export const GET = defineHandler(requireAdmin, async () => {
  const reports = await Fame.get('global').listReports(REPORT_PAGE_SIZE);
  return { reports };
});

export const DELETE = defineHandler(requireAdmin, async () => {
  await Fame.get('global').clearReports();
  return { reports: [] };
});
