import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { getValidationRules } from '@/lib/server-stub/ledger-actions';
import { ValidationRulesClient } from './validation-rules-client';

export const metadata: Metadata = { title: 'Validation rules · Apar Dashboard' };

export default async function ValidationRulesPage() {
  const rules = await getValidationRules();
  return (
    <>
      <ProfileHeader
        title="Validation rules"
        subtitle="Toggle which checks fire when transactions are drafted. Block-severity rules prevent posting; warn-severity require acknowledge."
        back={{ href: '/', label: 'Back to dashboard' }}
      />
      <ValidationRulesClient initial={rules} />
    </>
  );
}
