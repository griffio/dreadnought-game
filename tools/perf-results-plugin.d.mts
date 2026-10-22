import type { Plugin } from 'vite';

export function validSurvey(text: string): { rows: { name: string; costMs: number }[]; userAgent?: string } | null;
export function surveyFileName(survey: { userAgent?: string }, now?: Date): string;
export default function perfResults(dir?: string): Plugin;
