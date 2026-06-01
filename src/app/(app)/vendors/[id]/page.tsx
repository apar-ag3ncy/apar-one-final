import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { VendorDetailTabs } from '@/components/vendors/vendor-detail-tabs';
import { getVendor } from '@/lib/server-stub/entity-actions';
import { ProfileHeader } from '@/components/entity/profile-header';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const vendor = await getVendor(id);
  return { title: vendor ? `${vendor.name} · Apār Dashboard` : 'Vendor · Apār Dashboard' };
}

export default async function VendorDetailPage({ params }: Props) {
  const { id } = await params;
  // TODO(backend): swap for getVendor(id) once Backend ships the query helper.
  const vendor = await getVendor(id);
  if (!vendor) notFound();

  return (
    <>
      <ProfileHeader
        title={vendor.name}
        subtitle={
          <>
            {vendor.category} · {vendor.city}
          </>
        }
        status={{
          tone: vendor.status === 'active' ? 'success' : 'neutral',
          label: vendor.status === 'active' ? 'Active' : 'Inactive',
        }}
        back={{ href: '/vendors', label: 'All vendors' }}
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              disabled
              title="Server action pending (Backend agent)."
            >
              Edit
            </Button>
            <Button size="sm" disabled title="Server action pending (Backend agent).">
              Record payment
            </Button>
          </>
        }
      />
      <VendorDetailTabs vendor={vendor} />
    </>
  );
}
