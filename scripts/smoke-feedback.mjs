import sharp from 'sharp';

const base = process.env.FEEDBACK_SMOKE_URL;
const token = process.env.FEEDBACK_SMOKE_ACCESS_TOKEN;
const bypassToken = process.env.FEEDBACK_SMOKE_BYPASS_TOKEN;
if (!base || !token)
  throw new Error(
    'Set FEEDBACK_SMOKE_URL and FEEDBACK_SMOKE_ACCESS_TOKEN for a signed-in test account.',
  );
const url = new URL(base);
if (url.protocol !== 'https:') throw new Error('Use an HTTPS preview deployment.');
const headers = {
  Authorization: `Bearer ${token}`,
  'User-Agent': 'GarageGuardianSyntheticSmoke/1.0',
};
if (bypassToken) headers['x-vercel-protection-bypass'] = bypassToken;
const configResponse = await fetch(new URL('/api/feedback/config', url), { headers });
const configuration = await configResponse.json();
if (!configResponse.ok || !configuration.enabled)
  throw new Error('The preview reporter is not configured.');
// The Preview deployment must use the Feedback test (FBT) Linear key and team.
if (configuration.metadata.environment !== 'preview')
  throw new Error(
    'Use a preview deployment configured with the Feedback test team; this script refuses production.',
  );
const bytes = await sharp({
  create: { width: 160, height: 90, channels: 3, background: '#17804f' },
})
  .png()
  .toBuffer();
const report = {
  submissionId: crypto.randomUUID(),
  description:
    'Synthetic test only. Steps: send a generated green screenshot. Expected: exactly one Linear issue with the screenshot and app context. Actual: inspect this issue to verify rendering.',
  acknowledged: true,
  metadata: configuration.metadata,
  context: {
    pathname: '/',
    screen: 'dashboard',
    dialog: 'none',
    viewport: { width: 160, height: 90, pixelRatio: 1 },
    locale: 'en-US',
    online: true,
  },
  diagnostics: [],
};
console.log(`Synthetic submission ID: ${report.submissionId}`);
const form = new FormData();
form.append('report', JSON.stringify(report));
form.append('screenshots', new Blob([bytes], { type: 'image/png' }), 'synthetic.png');
const response = await fetch(new URL('/api/feedback', url), {
  method: 'POST',
  headers,
  body: form,
});
const result = await response.json();
if (!response.ok || result.state !== 'succeeded')
  throw new Error(
    `Smoke test did not confirm delivery: ${result.code || result.state || response.status}. Check the submission status before retrying.`,
  );
if (!/^FBT-\d+$/.test(result.issueReference))
  throw new Error(
    `The report went to ${result.issueReference}, not the Feedback test team. Fix the Preview Linear settings and cancel that issue.`,
  );
const statusResponse = await fetch(new URL(`/api/feedback/${report.submissionId}`, url), {
  headers,
});
const status = await statusResponse.json();
if (!statusResponse.ok || status.issueReference !== result.issueReference)
  throw new Error('Submission receipt did not match the created issue.');
// Resending the same draft must return the same issue instead of creating another.
const resend = new FormData();
resend.append('report', JSON.stringify(report));
resend.append('screenshots', new Blob([bytes], { type: 'image/png' }), 'synthetic.png');
const replayResponse = await fetch(new URL('/api/feedback', url), {
  method: 'POST',
  headers,
  body: resend,
});
const replay = await replayResponse.json();
if (!replayResponse.ok || replay.issueReference !== result.issueReference)
  throw new Error('Resending the same draft did not return the original issue.');
console.log(`Delivered synthetic report: ${result.issueReference}`);
console.log(
  'In Linear, inspect the screenshot and issue text, confirm the screenshot does not open when signed out, then cancel the synthetic issue.',
);
