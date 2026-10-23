import { describe, expect, it } from 'vitest';
import { sameOrigin, surveyFileName, validSurvey } from '../tools/perf-results-plugin.mjs';

const REPORT = { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Safari', rows: [{ name: 'baseline', costMs: 8.1 }, { name: 'ship broken in two', costMs: 8.4 }] };

describe('the perf results the iPad sends', () => {
  it('accepts a survey report and nothing else', () => {
    expect(validSurvey(JSON.stringify(REPORT))).toEqual(REPORT);
    expect(validSurvey('not json')).toBeNull();
    expect(validSurvey('{}')).toBeNull();
    expect(validSurvey(JSON.stringify({ rows: [] }))).toBeNull();
    expect(validSurvey(JSON.stringify({ rows: [{ name: 'x' }] }))).toBeNull();
    expect(validSurvey(JSON.stringify({ rows: [{ name: 3, costMs: 1 }] }))).toBeNull();
    expect(validSurvey('[1,2]')).toBeNull();
  });

  it('names the file from when it was made and what made it, with nothing that could leave the folder', () => {
    const name = surveyFileName(REPORT, new Date('2026-10-22T20:15:30.123Z'));
    expect(name).toBe('survey-2026-10-22T20-15-30-123Z-ipad.json');
    expect(surveyFileName({ userAgent: 'Macintosh Safari' }, new Date('2026-10-22T20:15:30.123Z'))).toMatch(/-macintosh\.json$/);
    expect(surveyFileName({}, new Date('2026-10-22T20:15:30.123Z'))).toMatch(/-device\.json$/);
    // A hostile user agent adds nothing to the name.
    expect(surveyFileName({ userAgent: '../../etc/passwd iPad' }, new Date(0))).not.toMatch(/[/\\]/);
  });
});

describe('the endpoint takes reports only from its own page', () => {
  const req = (headers: Record<string, string>) => ({ headers });
  it('trusts the browser\'s fetch metadata first', () => {
    expect(sameOrigin(req({ 'sec-fetch-site': 'same-origin', origin: 'https://evil.example' }))).toBe(true);
    expect(sameOrigin(req({ 'sec-fetch-site': 'cross-site', host: '10.0.0.2:5173', origin: 'https://10.0.0.2:5173' }))).toBe(false);
  });
  it('else compares the origin with the host, and lets a plain client without either through', () => {
    expect(sameOrigin(req({ host: '10.0.0.2:5173', origin: 'https://10.0.0.2:5173' }))).toBe(true);
    expect(sameOrigin(req({ host: '10.0.0.2:5173', origin: 'https://evil.example' }))).toBe(false);
    expect(sameOrigin(req({ host: '10.0.0.2:5173', origin: 'not a url' }))).toBe(false);
    expect(sameOrigin(req({ host: '10.0.0.2:5173' }))).toBe(true);
  });
});
