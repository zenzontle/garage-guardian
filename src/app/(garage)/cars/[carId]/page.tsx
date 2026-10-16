import { CarsScreen } from '@/components/vehicles/cars-screen';

export default async function CarPage({ params }: { params: Promise<{ carId: string }> }) {
  const { carId } = await params;
  return <CarsScreen carId={carId} />;
}
