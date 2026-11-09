import { accountDeletionRequest, accountRequest } from '@/lib/account/account-server';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const PATCH = (request: Request) => accountRequest(request);
export const DELETE = (request: Request) => accountDeletionRequest(request);
