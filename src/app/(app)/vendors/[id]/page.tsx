import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { VendorDetailTabs } from '@/components/vendors/vendor-detail-tabs';
import { getVendor } from '@/lib/server-stub/entity-actions';
import { getActorContext } from '@/lib/server/actor';
import { hasCapability } from '@/lib/rbac';
import { ProfileHeader } from '@/components/entity/profile-header';
import { VendorEditButton } from '@/components/vendors/vendor-edit-button';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const vendor = await getVendor(id);
  return { title: vendor ? `${vendor.name} · Apār Dashboard` : 'Vendor · Apār Dashboard' };
}

export default async function VendorDetailPage({ params }: Props) {
  const { id } = await params;
  const [vendor, actor] = await Promise.all([getVendor(id), getActorContext()]);
  if (!vendor) notFound();

  const canEdit = hasCapability(actor, 'update_vendor');

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
          canEdit ? (
            <VendorEditButton vendor={vendor} />
          ) : (
            <Button size="sm" variant="outline" disabled title="Your role can't edit vendors.">
              Edit
            </Button>
          )
        }
      />
      <VendorDetailTabs vendor={vendor} />
    </>
  );
}
