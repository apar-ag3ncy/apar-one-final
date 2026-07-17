-- Custom probation period. When set, the "Probation" badge and the days-left
-- count derive from this date instead of the default 6-months-from-joining
-- window. NULL keeps the legacy derived behaviour for eligible employment
-- types. Cleared (set to NULL) when an employee is confirmed / marked fixed.
ALTER TABLE "employees" ADD COLUMN "probation_ends_on" date;
