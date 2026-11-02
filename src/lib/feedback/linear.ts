import { z } from 'zod';
import { ReportError, identifier, type ReportConfig } from './server-config';
import { LINEAR_ASSET_URL, REPORT_LIMITS, isIssueReference } from './shared';

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
  issueCreate: z.object({
    success: z.literal(true),
    issue: z.object({ identifier: z.string() }),
  }),
});
const lookupSchema = z.object({
  issues: z.object({ nodes: z.array(z.object({ identifier: z.string() })).max(1) }),
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
export function linearAdapter(config: ReportConfig) {
  async function send(url: string, init: RequestInit, creating: boolean): Promise<Response> {
    try {
      const response = await fetch(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) {
        const retry = Number(response.headers.get('retry-after'));
        throw new DeliveryFailure(
          creating && response.status >= 500,
          retry > 0 && retry <= 86400 ? retry : undefined,
        );
      }
      return response;
    } catch (cause) {
      if (cause instanceof DeliveryFailure) throw cause;
      throw new DeliveryFailure(creating);
    }
  }
  async function graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
    creating = false,
  ): Promise<T> {
    const response = await send(
      LINEAR_API,
      {
        method: 'POST',
        headers: { Authorization: config.linearApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      },
      creating,
    );
    let result;
    try {
      result = z
        .object({ data: z.unknown().optional(), errors: z.array(z.unknown()).optional() })
        .parse(await response.json());
    } catch {
      throw new DeliveryFailure(creating);
    }
    // Linear rejected the operation, so a creation did not happen.
    if (result.errors?.length) throw new DeliveryFailure(false);
    const data = schema.safeParse(result.data);
    if (!data.success) throw new DeliveryFailure(creating);
    return data.data;
  }
  function reference(value: string) {
    if (!isIssueReference(value)) throw new DeliveryFailure(true);
    return value;
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
      if (
        new URL(uploadFile.uploadUrl).protocol !== 'https:' ||
        uploadFile.assetUrl.length > REPORT_LIMITS.assetUrl ||
        !LINEAR_ASSET_URL.test(uploadFile.assetUrl)
      )
        throw new DeliveryFailure(false);
      let headers: Headers;
      try {
        headers = new Headers({ 'Content-Type': 'image/webp' });
        for (const { key, value } of uploadFile.headers) headers.set(key, value);
      } catch {
        throw new DeliveryFailure(false);
      }
      // The signed upload URL carries its own authorization; never send the API key there.
      await send(
        uploadFile.uploadUrl,
        { method: 'PUT', headers, body: new Blob([new Uint8Array(bytes)]) },
        false,
      );
      return uploadFile.assetUrl;
    },
    async create(title: string, description: string, issueId: string): Promise<string> {
      let result;
      try {
        result = await graphql(
          `
            mutation FeedbackCreate($input: IssueCreateInput!) {
              issueCreate(input: $input) {
                success
                issue {
                  identifier
                }
              }
            }
          `,
          { input: { id: issueId, teamId: config.linearTeamId, title, description } },
          createSchema,
          true,
        );
      } catch (cause) {
        if (!(cause instanceof DeliveryFailure) || cause.ambiguous) throw cause;
        // A rejected retry may mean an earlier attempt already created this ID.
        const existing = await lookup(issueId).catch(() => null);
        if (existing) return existing;
        throw cause;
      }
      return reference(result.issueCreate.issue.identifier);
    },
    reconcile: lookup,
  };
  async function lookup(issueId: string): Promise<string | null> {
    // A filter returns an empty list for a missing issue; issue(id) reports it as an error.
    const result = await graphql(
      `
        query FeedbackLookup($id: ID!, $teamId: ID!) {
          issues(
            filter: { id: { eq: $id }, team: { id: { eq: $teamId } } }
            first: 1
            includeArchived: true
          ) {
            nodes {
              identifier
            }
          }
        }
      `,
      { id: issueId, teamId: config.linearTeamId },
      lookupSchema,
    );
    const found = result.issues.nodes[0];
    return found ? reference(found.identifier) : null;
  }
}
export type LinearAdapter = ReturnType<typeof linearAdapter>;
