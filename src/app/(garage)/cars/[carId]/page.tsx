import { CarsScreen } from '@/components/cars-screen';

export default async function CarPage({ params }: { params: Promise<{ carId: string }> }) {
  const { carId } = await params;
  return <CarsScreen carId={carId} />;
}
