import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { EmployeeWizard } from './employee-wizard';

export const metadata: Metadata = {
  title: 'New employee · Apār Dashboard',
};

export default function NewEmployeePage() {
  return (
    <>
      <ProfileHeader
        title="New employee"
        subtitle="Seven steps. KYC is stored masked — full PAN/Aadhaar live only in the encrypted KYC vault. The offer/contract gates creation server-side: signed (uploading now), or pending with a reason + ETA within 30 days."
        back={{ href: '/employees', label: 'All employees' }}
      />
      <EmployeeWizard />
    </>
  );
}
