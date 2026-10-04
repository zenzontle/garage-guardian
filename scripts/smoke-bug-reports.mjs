import sharp from 'sharp';

const base = process.env.BUG_REPORT_SMOKE_URL;
const token = process.env.BUG_REPORT_SMOKE_ACCESS_TOKEN;
if (!base || !token) throw new Error('Set BUG_REPORT_SMOKE_URL and BUG_REPORT_SMOKE_ACCESS_TOKEN for a signed-in test account.');
const url = new URL(base);
if (url.protocol !== 'https:') throw new Error('Use an HTTPS preview deployment.');
const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'GarageGuardianSyntheticSmoke/1.0' };
const configResponse = await fetch(new URL('/api/bug-reports/config', url), { headers });
const configuration = await configResponse.json();
if (!configResponse.ok || !configuration.enabled) throw new Error('The preview reporter is not configured.');
if (configuration.metadata.environment !== 'preview' || configuration.metadata.repository === 'zenzontle/garage-guardian') throw new Error('Use a preview deployment pointed at a separate TEST repository; this script refuses production and the real issue tracker.');
const bytes = await sharp({ create: { width: 160, height: 90, channels: 3, background: '#17804f' } }).png().toBuffer();
const report = {
  submissionId: crypto.randomUUID(), title: 'Synthetic bug reporter smoke test',
  description: 'Synthetic test only. Steps: send a generated green screenshot. Expected: exactly one issue with the screenshot and app context. Actual: inspect this issue to verify rendering.',
  acknowledged: true, metadata: configuration.metadata, context: { pathname: '/', screen: 'dashboard', dialog: 'none', viewport: { width: 160, height: 90, pixelRatio: 1 }, locale: 'en-US', online: true }, diagnostics: [],
};
console.log(`Synthetic submission ID: ${report.submissionId}`);
const form = new FormData(); form.append('report', JSON.stringify(report)); form.append('screenshots', new Blob([bytes], { type: 'image/png' }), 'synthetic.png');
const response = await fetch(new URL('/api/bug-reports', url), { method: 'POST', headers, body: form });
const result = await response.json();
if (!response.ok || result.state !== 'succeeded') throw new Error(`Smoke test did not confirm publication: ${result.code || result.state || response.status}. Check the submission status before retrying.`);
const statusResponse = await fetch(new URL(`/api/bug-reports/${report.submissionId}`, url), { headers });
const status = await statusResponse.json();
if (!statusResponse.ok || status.issueUrl !== result.issueUrl) throw new Error('Submission receipt did not match the created issue.');
console.log(`Published synthetic report: ${result.issueUrl}`);
console.log('Inspect the screenshot and public issue text, then close the synthetic test issue.');
