import { z } from 'zod';
import { ReportError, describeCause, identifier, type ReportConfig } from './server-config';
import { LINEAR_ASSET_URL, REPORT_LIMITS } from './shared';

const LINEAR_API = 'https://api.linear.app/graphql';
const uploadSchema = z.object({
  fileUpload: z.object({
    success: z.literal(true),
    uploadFile: z.object({
      uploadUrl: z.string().url(),
      assetUrl: z.string(),
      headers: z.array(z.object({ key: z.string(), value: z.string() })),
    }),
  }),
});
const createSchema = z.object({
  issueCreate: z.object({ success: z.literal(true) }),
});
const lookupSchema = z.object({
  issues: z.object({ nodes: z.array(z.object({ id: z.string() })).max(1) }),
});
export class DeliveryFailure extends ReportError {
  constructor(
    public ambiguous: boolean,
    retryAfter?: number,
  ) {
    super(
      502,
      ambiguous ? 'DELIVERY_UNKNOWN' : 'DELIVERY_FAILED',
      ambiguous
        ? 'Delivery status is unknown. Check status before trying again.'
        : 'The report could not be delivered. Your draft has been kept.',
      retryAfter,
    );
  }
}
const errorSchema = z.object({
  message: z.string().optional(),
  extensions: z.object({ code: z.string().optional(), type: z.string().optional() }).optional(),
});
// GraphQL repeats a rejected variable's value, which for issueCreate is the report itself.
const INVALID_VARIABLE = /^Variable "(\$\w{1,40})" got invalid value/;
// The reason after the value; graphql-js may append a "Did you mean" suggestion.
const SCHEMA_REASON =
  /; (Field "\w{1,60}" (?:is not defined by type "\w{1,60}"|of required type "[\w![\]]{1,60}" was not provided)\.)(?: Did you mean [\w", ]{1,200}\?)?$/;
// Schema names (types, fields, enum values) stay readable; other quoted text may be input.
const SCHEMA_NAME = /^[A-Za-z_$][\w$.![\]]{0,59}$/;
function safeMessage(message: string, sensitive: string[]): string {
  const variable = INVALID_VARIABLE.exec(message);
  if (variable) {
    const reason = SCHEMA_REASON.exec(message);
    return `Variable "${variable[1]}" got an invalid value${reason ? `; ${reason[1]}` : ''}`;
  }
  let text = message.replace(/"([^"]*)"/g, (quoted, inner: string) =>
    SCHEMA_NAME.test(inner) ? quoted : '"<redacted>"',
  );
  for (const value of sensitive) if (value) text = text.split(value).join('<redacted>');
  return text.slice(0, 200);
}
// Only Linear's error text and codes; never the API key, signed URLs, or report content.
function describeErrors(errors: unknown[], sensitive: string[]): string {
  return errors
    .slice(0, 3)
    .map((error) => {
      const parsed = errorSchema.safeParse(error);
      if (!parsed.success) return 'unreadable error';
      const { message, extensions } = parsed.data;
      const code = extensions?.code || extensions?.type;
      return `${message ? safeMessage(message, sensitive) : 'no message'}${code ? ` (${code.slice(0, 60)})` : ''}`;
    })
    .join(' | ');
}
async function describeResponse(response: Response, sensitive: string[]): Promise<string> {
  let detail = '';
  try {
    const errors = z.object({ errors: z.array(z.unknown()) }).safeParse(await response.json());
    if (errors.success) detail = `: ${describeErrors(errors.data.errors, sensitive)}`;
  } catch {
    // Not JSON (for example, a storage error page); the status is enough.
  }
  return `HTTP ${response.status}${detail}`;
}
function failure(operation: string, reason: string, ambiguous: boolean, retryAfter?: number) {
  // Vercel keeps this in the function logs; the client only sees the generic code.
  console.error(`[feedback] Linear ${operation} failed: ${reason}`);
  return new DeliveryFailure(ambiguous, retryAfter);
}
export function linearAdapter(config: ReportConfig) {
  async function send(
    operation: string,
    url: string,
    init: RequestInit,
    creating: boolean,
    sensitive: string[] = [],
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(12_000),
      });
    } catch (cause) {
      throw failure(operation, describeCause(cause), creating);
    }
    if (!response.ok) {
      const retry = Number(response.headers.get('retry-after'));
      throw failure(
        operation,
        await describeResponse(response, sensitive),
        creating && response.status >= 500,
        retry > 0 && retry <= 86400 ? retry : undefined,
      );
    }
    return response;
  }
  async function graphql<T>(
    operation: string,
    query: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
    creating = false,
    // Report text that Linear's error messages must not carry into the logs.
    sensitive: string[] = [],
  ): Promise<T> {
    const response = await send(
      operation,
      LINEAR_API,
      {
        method: 'POST',
        headers: { Authorization: config.linearApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      },
      creating,
      sensitive,
    );
    let result;
    try {
      result = z
        .object({ data: z.unknown().optional(), errors: z.array(z.unknown()).optional() })
        .parse(await response.json());
    } catch {
      throw failure(operation, 'response is not the expected JSON', creating);
    }
    // Linear rejected the operation, so a creation did not happen.
    if (result.errors?.length)
      throw failure(operation, describeErrors(result.errors, sensitive), false);
    const data = schema.safeParse(result.data);
    if (!data.success) throw failure(operation, 'response data has an unexpected shape', creating);
    return data.data;
  }
  return {
    // Reporters cannot predict the ID, and every retry of one draft reuses it.
    issueId(userId: string, submissionId: string): string {
      // Linear IDs are unique per workspace, so the team keeps Preview and Production apart.
      const hex = identifier(config, 'issue', `${config.linearTeamId}:${userId}:${submissionId}`);
      const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    },
    async upload(bytes: Uint8Array, index: number): Promise<string> {
      const { uploadFile } = (
        await graphql(
          'fileUpload',
          `
            mutation FeedbackUpload($contentType: String!, $filename: String!, $size: Int!) {
              fileUpload(contentType: $contentType, filename: $filename, size: $size) {
                success
                uploadFile {
                  uploadUrl
                  assetUrl
                  headers {
                    key
                    value
                  }
                }
              }
            }
          `,
          {
            contentType: 'image/webp',
            filename: `screenshot-${index + 1}.webp`,
            size: bytes.length,
          },
          uploadSchema,
        )
      ).fileUpload;
      if (new URL(uploadFile.uploadUrl).protocol !== 'https:')
        throw failure('fileUpload', 'upload URL is not HTTPS', false);
      if (
        uploadFile.assetUrl.length > REPORT_LIMITS.assetUrl ||
        !LINEAR_ASSET_URL.test(uploadFile.assetUrl)
      )
        throw failure('fileUpload', 'asset URL has an unexpected form', false);
      let headers: Headers;
      try {
        headers = new Headers({ 'Content-Type': 'image/webp' });
        for (const { key, value } of uploadFile.headers) headers.set(key, value);
      } catch {
        throw failure('fileUpload', 'upload headers are invalid', false);
      }
      // The signed upload URL carries its own authorization; never send the API key there.
      await send(
        'screenshot PUT',
        uploadFile.uploadUrl,
        { method: 'PUT', headers, body: new Blob([new Uint8Array(bytes)]) },
        false,
      );
      return uploadFile.assetUrl;
    },
    async create(title: string, description: string, issueId: string): Promise<void> {
      try {
        await graphql(
          'issueCreate',
          `
            mutation FeedbackCreate($input: IssueCreateInput!) {
              issueCreate(input: $input) {
                success
              }
            }
          `,
          { input: { id: issueId, teamId: config.linearTeamId, title, description } },
          createSchema,
          true,
          [title, description],
        );
      } catch (cause) {
        if (!(cause instanceof DeliveryFailure) || cause.ambiguous) throw cause;
        // A rejected retry may mean an earlier attempt already created this ID.
        if (await lookup(issueId).catch(() => false)) return;
        throw cause;
      }
    },
    reconcile: lookup,
  };
  async function lookup(issueId: string): Promise<boolean> {
    // A filter returns an empty list for a missing issue; issue(id) reports it as an error.
    const result = await graphql(
      'issue lookup',
      `
        query FeedbackLookup($id: ID!, $teamId: ID!) {
          issues(
            filter: { id: { eq: $id }, team: { id: { eq: $teamId } } }
            first: 1
            includeArchived: true
          ) {
            nodes {
              id
            }
          }
        }
      `,
      { id: issueId, teamId: config.linearTeamId },
      lookupSchema,
    );
    return result.issues.nodes.length > 0;
  }
}
export type LinearAdapter = ReturnType<typeof linearAdapter>;
