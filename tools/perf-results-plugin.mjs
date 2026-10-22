// Dev-server plugin: receives the in-page Perf survey's results (POST /__perf, a JSON body) and writes them to perf-results/, so that a
// survey run on the iPad needs no copying out of the page. Development only (`apply: 'serve'`); nothing of it is in the build.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The survey report if the text is one (a JSON object with rows that each have a name and a cost), else null. */
export function validSurvey(text) {
  try {
    const v = JSON.parse(text);
    const ok = Array.isArray(v?.rows) && v.rows.length > 0 && v.rows.every((r) => typeof r?.name === 'string' && Number.isFinite(r?.costMs));
    return ok ? v : null;
  } catch {
    return null;
  }
}

/** A file name for a report: when it was made and what made it. */
export function surveyFileName(survey, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const device = /iPad|iPhone|Android|Windows|Macintosh/.exec(String(survey.userAgent ?? ''))?.[0]?.toLowerCase() ?? 'device';
  return `survey-${stamp}-${device}.json`;
}

const MAX_BYTES = 1_000_000;

export default function perfResults(dir = 'perf-results') {
  return {
    name: 'perf-results',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__perf', (req, res) => {
        const reply = (status, body) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return reply(405, { error: 'POST a survey report' });
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size <= MAX_BYTES) chunks.push(chunk);
        });
        req.on('end', () => {
          if (size > MAX_BYTES) return reply(413, { error: 'too large' });
          const text = Buffer.concat(chunks).toString('utf8');
          const survey = validSurvey(text);
          if (!survey) return reply(400, { error: 'not a survey report' });
          const folder = join(server.config.root, dir);
          const file = surveyFileName(survey);
          try {
            mkdirSync(folder, { recursive: true });
            writeFileSync(join(folder, file), JSON.stringify(survey, null, 2));
          } catch (e) {
            return reply(500, { error: String(e) });
          }
          reply(200, { file: `${dir}/${file}`, rows: survey.rows.length });
        });
      });
    },
  };
}
