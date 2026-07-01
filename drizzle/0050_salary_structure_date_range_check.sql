-- Guard salary_structures against an inverted version interval (effective_to
-- earlier than effective_from). Mirrors the leaves table's
-- leaves_date_range_ordered CHECK.
--
-- Defense-in-depth for the back-dated auto-close bug fixed in
-- createSalaryStructure (payroll.ts): a new structure back-dated before an
-- existing later one used to push that later structure's effective_to before
-- its own effective_from, silently destroying its captured comp. The app fix
-- stops producing such rows; this CHECK makes Postgres reject any that slip
-- through loudly instead of corrupting the timeline. Safe to add — there are no
-- salary_structures rows yet.
ALTER TABLE "salary_structures"
  ADD CONSTRAINT "salary_structures_date_range_ordered"
  CHECK (effective_to IS NULL OR effective_to >= effective_from);
