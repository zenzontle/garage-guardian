import { accountRequest } from '@/lib/account-server';

export const runtime = 'nodejs';
export const PATCH = (request: Request) => accountRequest(request, false);
export const DELETE = (request: Request) => accountRequest(request, true);
