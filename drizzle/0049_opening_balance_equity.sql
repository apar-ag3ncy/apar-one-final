-- 0049_opening_balance_equity — a neutral equity account for bank opening
-- balances.
--
-- When a bank account's opening balance is set, the opening journal credits
-- equity. The preferred counter-account is 3100 Partner Capital, but 3100 is a
-- control account sub-ledgered by partner user — so it can't be used when there
-- is no `partner` user on file. 3900 is the fallback: a non-control equity
-- account (no subledger) so the opening balance ALWAYS posts and the books
-- tally regardless of partner setup. Standard "Opening Balance Equity" pattern.
INSERT INTO accounts (code, name, type, is_control, subledger_kind)
VALUES ('3900', 'Opening Balance Equity', 'equity', false, NULL)
ON CONFLICT (code) DO NOTHING;
