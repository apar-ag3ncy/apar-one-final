import type { Metadata } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ContactList, type Contact } from '@/components/entity/contact-list';
import { AddressList, type Address } from '@/components/entity/address-list';
import { BankAccountList, type BankAccount } from '@/components/entity/bank-account-list';
import { TaxIdentifierList, type TaxIdentifier } from '@/components/entity/tax-identifier-list';

export const metadata: Metadata = { title: 'My profile · Apar self-service' };

// TODO(backend): swap for getMyProfile() once A ships.
const CONTACTS: readonly Contact[] = [
  {
    id: 'c1',
    name: 'Anjali Mehta',
    title: 'Self',
    email: 'anjali@apar.example',
    phone: '+91 98200 12345',
    isPrimary: true,
  },
  { id: 'c2', name: 'Vikram Mehta (spouse)', title: 'Emergency', phone: '+91 98200 99999' },
];

const ADDRESSES: readonly Address[] = [
  {
    id: 'a1',
    label: 'Home',
    line1: 'A-12, Sea Breeze Apartments',
    line2: 'Worli Sea Face',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400018',
    country: 'India',
    isPrimary: true,
    kind: 'residence',
  },
];

const BANKS: readonly BankAccount[] = [
  {
    id: 'b1',
    bankName: 'HDFC Bank',
    maskedNumber: 'XXXX XXXX 4321',
    ifsc: 'HDFC0001234',
    holderName: 'Anjali Mehta',
    accountType: 'Savings',
    isPrimary: true,
  },
];

const TAX_IDS: readonly TaxIdentifier[] = [
  { id: 't1', kind: 'pan', maskedValue: 'XXXXXX1234X', revealable: true },
  { id: 't2', kind: 'aadhaar', maskedValue: 'XXXX XXXX 1234', revealable: true },
];

export default function MeProfilePage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>
        <p className="text-muted-foreground text-sm">
          Personal details, emergency contacts, address, bank, tax IDs. Anything sensitive requires
          partner/HR approval before it changes.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contacts</CardTitle>
        </CardHeader>
        <CardContent>
          <ContactList contacts={CONTACTS} entityName="me" />
        </CardContent>
      </Card>

      <AddressList addresses={ADDRESSES} entityName="me" />
      <BankAccountList accounts={BANKS} entityName="me" canReveal={false} />
      <TaxIdentifierList identifiers={TAX_IDS} entityName="me" canReveal={false} />

      <p className="text-muted-foreground text-xs">
        Bank / tax-ID full-value reveal is intentionally disabled in self-service. Email HR if you
        need to verify a stored value.
      </p>
    </div>
  );
}
