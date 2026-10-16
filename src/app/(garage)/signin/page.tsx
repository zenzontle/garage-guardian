import { AccountScreen } from '@/components/account/account-screen';
import { validatedReturnTo } from '@/lib/navigation/garage-routes';

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
