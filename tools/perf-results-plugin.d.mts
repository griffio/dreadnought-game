import type { Plugin } from 'vite';

export function validSurvey(text: string): { rows: { name: string; costMs: number }[]; userAgent?: string } | null;
export function surveyFileName(survey: { userAgent?: string }, now?: Date): string;
/** Whether a request comes from the dev server's own page (by Fetch metadata or Origin); a request with neither is allowed. */
export function sameOrigin(req: { headers: Record<string, string | string[] | undefined> }): boolean;
export default function perfResults(dir?: string): Plugin;
