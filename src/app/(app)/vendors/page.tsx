import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { VendorsList } from '@/components/vendors/vendors-list';
import { listVendors } from '@/lib/server-stub/entity-actions';
import { PageHeader } from '@/components/shared/page-header';

export const metadata: Metadata = {
  title: 'Vendors · Apār Dashboard',
};

export default async function VendorsPage() {
  const data = await listVendors();
  return (
    <>
      <PageHeader
        title="Vendors"
        description={`${data.length} vendor${data.length === 1 ? '' : 's'} tracked. GST/TDS captured per vendor — never calculated.`}
        actions={
          <Button size="sm" asChild>
            <Link href="/vendors/new">New vendor</Link>
          </Button>
        }
      />
      <VendorsList data={data} />
    </>
  );
}
