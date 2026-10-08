import { AccountScreen } from '@/components/account-screen';
import { validatedReturnTo } from '@/lib/garage-routes';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { returnTo } = await searchParams;
  return (
    <AccountScreen
      mode="signin"
      returnTo={validatedReturnTo(typeof returnTo === 'string' ? returnTo : null)}
    />
  );
}
