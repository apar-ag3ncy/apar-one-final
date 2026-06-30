import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ProfileHeader } from '@/components/entity/profile-header';
import { formatINR } from '@/components/shared/format-inr';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getAgencyBankAccount, getAgencyBankBook } from '@/lib/server/billing/agency-banks';

export const metadata: Metadata = { title: 'Bank book · Apar Dashboard' };

type Props = { params: Promise<{ bankId: string }>; searchParams: Promise<{ from?: string }> };

export default async function BankBookPage({ params, searchParams }: Props) {
  const { bankId } = await params;
  const { from } = await searchParams;
  const bank = await getAgencyBankAccount(bankId);
  if (!bank) notFound();

  const book = await getAgencyBankBook({ bankAccountId: bankId, from });

  return (
    <>
      <ProfileHeader
        title={bank.displayName}
        subtitle={`${bank.bankName} · ••${bank.accountLast4} · ${bank.accountType.toUpperCase()}`}
        back={{ href: '/banking', label: 'All bank accounts' }}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-muted-foreground text-xs">Current balance</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatINR(book.closingBalancePaise)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-muted-foreground text-xs">Opening balance</p>
            <p className="text-lg tabular-nums">{formatINR(bank.openingBalancePaise)}</p>
            <p className="text-muted-foreground text-xs">
              {bank.openingBalanceDate ? `as of ${bank.openingBalanceDate}` : 'not set'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-muted-foreground text-xs">Postings</p>
            <p className="text-lg tabular-nums">{book.lines.length}</p>
            {!bank.isActive && (
              <Badge variant="outline" className="text-muted-foreground mt-1">
                Inactive
              </Badge>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground border-b text-xs">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-left font-medium">Reference</th>
                  <th className="px-4 py-2 text-right font-medium">Money in</th>
                  <th className="px-4 py-2 text-right font-medium">Money out</th>
                  <th className="px-4 py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {from ? (
                  <tr className="text-muted-foreground border-b bg-muted/30">
                    <td className="px-4 py-2" colSpan={4}>
                      Brought forward (before {from})
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatINR(book.openingCarryPaise)}
                    </td>
                  </tr>
                ) : null}
                {book.lines.length === 0 ? (
                  <tr>
                    <td
                      className="text-muted-foreground px-4 py-10 text-center"
                      colSpan={5}
                    >
                      No postings yet. Recorded receipts and payments to this account will appear
                      here.
                    </td>
                  </tr>
                ) : (
                  book.lines.map((l) => (
                    <tr key={l.postingId} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums">{l.txnDate}</td>
                      <td className="px-4 py-2">
                        <div className="font-medium">{l.description ?? l.kind}</div>
                        <div className="text-muted-foreground text-xs">
                          {l.reference}
                          {l.status !== 'posted' ? ` · ${l.status}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-emerald-600">
                        {l.side === 'debit' ? formatINR(l.amountPaise) : ''}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-rose-600">
                        {l.side === 'credit' ? formatINR(l.amountPaise) : ''}
                      </td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums">
                        {formatINR(l.runningBalancePaise)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
