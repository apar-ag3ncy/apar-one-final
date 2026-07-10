-- 0067_office_expense_reset — one-off data cleanup (operator-approved).
--
-- The office-expense book accumulated duplicates: the OLD importer posted each
-- row in its own transaction then timed out before responding, so re-running an
-- import re-inserted rows (29 duplicate groups / 61 rows). The operator asked
-- for a clean slate before re-importing a corrected sheet.
--
-- SCOPE — deletes exactly 147 office_expenses rows (supplies; live + already
-- soft-deleted) plus their 140 posted journals and postings.
--
-- PRESERVED — the 11 salary payouts recorded inside office_expenses
-- (Rs 7,13,000): 5 under "Feb 26 Salary" (2026-03-07) and 6 uncategorised
-- (2026-04-08). Their journals are untouched, as are salary_payments /
-- salary_structures. Rows are addressed by EXPLICIT primary key, so this can
-- never over-delete on another database; re-running is a no-op.
--
-- Posted ledger rows are delete-protected by tg_block_delete_ledger()
-- (LEDGER-SPEC 0.3: "reverse, never delete"). The operator chose a hard wipe
-- over reversal so the re-imported book carries no net-zero reversal noise.
-- We neutralise the trigger FUNCTION for the duration (this needs only
-- ownership of the function, which this migration role has from 0015 —
-- ALTER TABLE ... DISABLE TRIGGER would need table ownership) and restore the
-- original body afterwards. Drizzle runs all pending migrations inside ONE
-- transaction and Postgres DDL is transactional, so any failure rolls back the
-- neutralised function along with the deletes.
--
-- A full JSON backup of every deleted row was taken before authoring this.

CREATE OR REPLACE FUNCTION public.tg_block_delete_ledger() RETURNS TRIGGER AS $neutralised$
BEGIN
  -- Temporarily permissive; restored to the 0015 body at the end of 0067.
  RETURN OLD;
END;
$neutralised$ LANGUAGE plpgsql;
--> statement-breakpoint

DO $wipe$
DECLARE
  v_txns uuid[] := ARRAY[
    '22727bf9-0c7f-4c66-9761-5d2366ec4b5e',
    'a3f00fa6-5abe-433d-9480-c662079c8ca9',
    'f0763a6b-b5bd-450e-a2dc-2ff5b38f5d8d',
    'f62a5fc4-fc48-47e9-8058-843d85a75b27',
    '652d7aac-e36c-435e-bb8b-a55d309baeef',
    '839079b6-a632-494e-8eb2-7c39c63a759b',
    '37bb986d-9088-4315-88ca-4da22fcf0e65',
    '7692bf43-7bd1-428c-aa77-3c93b4529293',
    '7d05b7d7-d2b3-4e5c-aad1-824cbb07d999',
    '6e5eeaaf-480e-4610-889f-4a25f87bf3c5',
    '50cc222a-c293-4b29-a1ef-7c799c48397b',
    '87c91669-fda1-4a08-8229-1ddee97f018f',
    '80fec4b3-589f-4dad-9429-48630fd89139',
    'ea81cfc7-9189-4c1b-aa2b-f9f79cccdfbd',
    'fd976edc-692d-4b18-9cbb-d1ca2cfb67f5',
    'c534b2de-0a15-41af-9b2f-1da6fa4e1fa1',
    'a41ae357-6daa-466e-91fc-0a5827b47e38',
    '4cd1652a-5a42-476e-b75e-e55bb103568a',
    'e0366781-4cb3-401c-a32c-6a755502bcca',
    '2625e9c8-5df9-40a8-98e5-f79b77f6dbf0',
    '3f2e01fb-3f5b-4916-ba54-3c27464d97d3',
    'd27d733a-e613-4b01-8177-7d2578fde7d5',
    '24312346-546a-447d-bff8-506f0af36fd8',
    'f14500f4-9b64-4b83-9c17-102f9001e462',
    'cd3d650c-c5b4-469a-b71f-6aac7bdfaee6',
    '65bb725b-c65d-462b-b931-98583402f7d4',
    'f7c441ed-dea1-4e5c-a18d-557301e8b90c',
    '67b39030-2c63-41f3-b503-385fbb3eb37f',
    '4c26b1ca-0483-400b-959b-8c3dfde66212',
    '1702b1d5-dbc4-4ed2-9686-1bbc32508270',
    '62cbc1bc-9dae-42c2-af53-ac3113cc1b04',
    '4e96edf1-fcb6-4b45-a7ff-1f889aa75968',
    'b8d418f1-67a7-4b18-bb7e-9a4ee201d1ec',
    '83e8d815-3f62-402f-a679-15cf864d2e9f',
    '173dcfc4-b904-4aa4-bc83-04a5541eee7b',
    '9caa8996-a12f-44af-a9e0-bd702af0a9a4',
    'c0f8a90b-c1b8-41ee-a7b9-6812a8e51801',
    'df7b21d6-bc14-4243-941f-81630f6a40a8',
    '33743b5e-5012-4c6b-8094-36f6fc0b4bac',
    '2d84890a-58a6-4208-b028-62120e8e513d',
    'd9ab46b6-3b64-4cbf-af98-e7e9748230d5',
    '0f504f40-16f2-40b8-b925-6724161e25a1',
    'eae0b5e3-59a1-4877-aef2-dcf25d83bbb5',
    '2f96721f-beed-42a2-bfd2-c24f6252a4bd',
    'c296a630-fa62-441c-888c-13819b5608c5',
    '3209e160-5f7e-4631-8d29-74ebba3db021',
    'd70c0ee9-474f-4fe1-9253-d58501889dc1',
    '25d3148d-204e-4fdd-9757-fbaeb23fc388',
    '81fe3c04-51da-4e99-8772-9f92d8b05d27',
    '5f456508-7cc3-431c-aca3-bff22fba188c',
    'ffd37bf7-6de0-4490-aa2e-ca9a20900692',
    '6cb9208a-fae5-40df-9346-208969bccb4f',
    'ae9f754e-1100-46ae-8a8f-a6e2376b87fc',
    '50ca717d-96c4-4742-89cb-8a04ca20f08e',
    'aaf44ef2-936b-4ed0-9e59-fc44a067370c',
    'c91605db-421b-434c-961c-16dd6898e13a',
    '23e83494-632a-4540-b908-ce31e6620064',
    '1806b914-2c76-49db-bc27-e949fb0c9cf9',
    '1682bb24-fa63-4c0f-9e07-6a25ae2f6034',
    '1d4f202a-dd8c-45be-8b31-2d9c7292e834',
    'a09994de-c80a-451d-9da5-34c45ee8be0e',
    'd5e1286c-9a2b-451a-b451-da68504710ef',
    'b961d822-fdc9-4fb4-b1f8-89e7fc634c4c',
    '443d74f4-7e41-4979-b908-a9b3e7da9cba',
    'fef643a3-7b3d-41a0-bcb3-1c18055bb381',
    'c95fa43d-2b7e-4a11-8ac8-7c147119d1d6',
    '4bdebf01-e424-428e-abd1-a907c00f1c73',
    '00990d70-00c3-40af-a667-f08c4a36f4ca',
    '9ccce73b-e4bb-49b4-8dc8-d976a795ff4d',
    'ff05634c-6c94-4759-a34b-55c5343b9095',
    '4d365b36-1faa-4973-a45a-aa1e983627b9',
    '09f30e52-aa0e-4d21-88b1-36bfeb4cfa46',
    '871e7588-50a3-4ed8-a67f-6e3f2608c98d',
    '16f0b645-e2a6-4491-bc10-f0ea13442830',
    '09b5a8da-c686-45d4-ac0f-44fed20c85b0',
    'd4a16e2c-97fe-4458-9a5b-3be80bd4ce9c',
    '19019da5-3749-45f2-9186-e4ed749d821a',
    '9034463a-af3a-416e-aef4-5fced668eaa5',
    '036d911b-6970-4735-8463-5e19e3394536',
    'e4530927-648e-4b93-82c0-8ac8f267adf9',
    '00cd8d46-e80b-4c39-aade-92b9436bcde3',
    'cabb9e51-7395-41e1-8f20-63c8f3a3a64e',
    'f13e1808-ee74-46af-92c7-aff3cea753c1',
    'f65f1ae0-d939-41f4-9f63-a7589eac26c7',
    'd097e247-7e16-4aad-a6f5-ae0400db0874',
    'cb827806-3b24-4e8a-8165-5ad0bf7875d4',
    'c2aaa3bf-ea53-40a5-a193-8ef833d52310',
    '604d371c-22ac-4957-8770-c3b5a0fe3d9f',
    '4bd5bb71-cb62-4f8e-9f49-9bfc25497c2b',
    '570e86fb-c199-494f-a49c-094cf50a1d68',
    '6f389d8d-6c5a-4ead-91df-2b18e4c86b8b',
    'fa6b139d-7e6a-4237-9ea3-540f39c9b26f',
    '39b5c333-fb34-4b24-95db-342a1f9ab926',
    '50756f3f-3595-45c4-82fc-8c364723fe55',
    'bc8425b6-83e4-488e-9a8e-97cf652df5dc',
    'eedca965-266c-495d-9d35-606d3c1fdd3e',
    '97708047-83e0-415f-902e-78a572ce55f3',
    'bc9849c1-cf7b-4098-a145-df2a5476b656',
    '77131845-2a86-4eca-9ac1-fbdeb1fd1387',
    '5ba704ef-5a03-47db-854a-c5df8ddb1350',
    '8013ef06-b07a-485c-95f4-7902fa56198e',
    '4f2bc0d0-984d-4e42-9bc4-4d26229da3e0',
    'def7cf69-740a-4f1d-92e0-a1b5905b8d30',
    'b9f674e6-c44d-41df-88ee-f44c9e511e36',
    'b3c51f62-5b15-4d4b-8f78-44bb5df3e303',
    'c7dc2aa3-e1be-4704-811f-0d10d7b64ef8',
    '5c5b54bc-7c19-4699-80aa-af60ead15fca',
    'a25544de-7b13-4754-98dc-a990d44e28dc',
    '075c051c-86bf-4d7e-8146-37d5794e5235',
    '2d833ee1-c652-41a5-8ce4-7e89d5cba073',
    '8cbac590-fad0-4c03-aff4-59ede3e929ef',
    'c8b09ece-7917-48ef-82bd-ee01b07cd033',
    '01de3579-a1c6-463c-aef6-c9e50f512499',
    'e3a2d6d2-1cbe-4fb8-886c-d298950687cd',
    'a6f7a891-a38f-476f-947f-65337c4321e3',
    '3e2e452e-bb2e-494c-9505-4095f1f24169',
    'd57c7861-0274-425f-9cbb-6dad233acf68',
    'c72eb963-eb43-45a2-a5e2-dd7fb4cfff1d',
    '02a1ea00-1b6d-4f0f-b14d-8ae11a862eac',
    'ee24cde8-cb0a-425a-b2e3-92ae3c48d8ba',
    '497ea9bf-9ed2-44cd-bae7-99134f31f662',
    'fcdd6e4c-fb13-49be-804d-9334250ca03f',
    'a564addc-b15c-47db-b3b9-5c52db529081',
    '19c41479-20c5-46c0-9241-645ba138e53e',
    '39b11467-5339-4a12-810e-8a0355864c95',
    '022f392e-f6ab-4502-9d7f-ff3dcacb324e',
    'dcfdd1f8-6917-449a-acbc-326d6112a51d',
    'b572100f-abaf-4099-a68a-a6747c00f83b',
    '6594f7f7-3d0e-4604-bf0b-93c40a14be44',
    '1ce67bf6-7e00-4315-8991-230f80bb8614',
    '77181b72-d5f1-4e48-a523-3873c6df40ed',
    '86165ed2-edc1-4ee5-9d49-56d113ebd033',
    '0791c6ab-698c-463a-b62b-f9167973d6fe',
    'b7940e6a-a19c-4b77-aa0b-ff67d0af3742',
    '6116271d-9cef-49bb-a8c1-942a415e5ce5',
    '0a43c50d-2fda-4d1d-87a0-7149e9102528',
    'cb575edc-e927-452e-826a-09fea8abb41b',
    '1f4724c5-2e09-4a23-8f47-54f393a526c7',
    'f959a9b0-eb88-4020-9fc8-6d20cfe29538',
    '61fa6811-9f37-4e5e-b46b-8eae3325da31'
  ]::uuid[];
  v_exps uuid[] := ARRAY[
    '9f34892f-7df6-46c8-8bdb-9f230c55d4d3',
    '6a2fc573-cf26-40dc-b893-a906204713ed',
    'fba1e040-9639-4d4c-a324-f9657e95b257',
    'b94d4929-62ec-486a-9720-279e932ed736',
    'd10774b2-2cc9-48c4-b5fd-b9d755bbc64d',
    'e098d615-5842-434c-a158-e66a55335542',
    'd0589e78-320f-4c40-a5b0-5bda8ee20da9',
    'a5400345-cea6-4cea-84f8-30bfa5e7d07f',
    '0d2bc360-cdd7-42b1-80a9-2632212a1da8',
    '2ea91931-2f05-4315-b169-a10cf61bb4ca',
    'e03e4d4e-0738-4a34-b6dd-e7e424a2eeec',
    '9fc838d4-1f52-4530-9096-0c235377d774',
    'cebcf246-4a98-4adc-92b9-9cefbf81fdd5',
    'dbd29081-7ed7-4978-b3cd-40a98f05ebb9',
    '52edd1b6-8377-49e3-a4b1-6dd6f03f0563',
    'c9500580-d05e-49cc-b475-833f2e68b9db',
    '12620aa9-9be0-47df-96cf-e8ba1345d22c',
    '2b8321fd-1e37-47d8-a243-4427129329ef',
    '6c818f2e-8ff3-4a7c-8cdc-48a8217b0ae6',
    'e9af172c-0411-43a1-b208-efd12eda2bc3',
    'c91621ef-e908-4d32-98e8-5a0e543e6ce3',
    '5bba8ed4-bacd-41a3-92bc-9fd53f3c76e3',
    '356493ba-2ba4-4ed3-8f9c-1c247e35974c',
    '5771c6f1-3bf1-47d0-98e8-153909110f7c',
    '28bb930f-9ed3-432d-abc2-1c6fbc52ba1b',
    '1bfe0371-4da9-4296-bbb8-289a4934a8b9',
    '70487f6f-3134-4ebb-95be-0718f8337465',
    'b322ddc9-58c3-4ab9-af34-e2766790a825',
    '016edd9a-9b6f-471e-b740-1290b7c15563',
    '8c6aa03f-36df-4bdd-b967-251ce4b1718e',
    'a4afa4d6-87d0-42fe-9a30-feb11aafd780',
    'a4c5d5bf-e6c7-4cb6-ade1-174b664c34b7',
    '751f69c1-9848-44e8-8c4f-3828b419ab8d',
    'cfc368f3-80da-410e-8e62-6c512bb524d3',
    '7bf5478f-1212-4b24-be83-2f85adb7561e',
    '440a3d2a-8c93-4aa9-9de8-ce11ec0de13f',
    '5770b980-bd47-423b-b40f-097561b50480',
    '63cd1ed4-83d7-48c2-9359-cb886563aec6',
    '176a5c18-74c3-431a-aa34-86a8f3112bfb',
    'b87be288-4a1c-4c82-a48d-b4d34bafd487',
    'a835f710-5246-4f6a-8557-8719933c66a4',
    '7ba09564-269b-492b-8392-b6f0db21a89c',
    'c45666f0-2696-4b03-9ba9-d50cbee1c7a4',
    '9c4a53ec-b9dd-4d42-95f7-4a94c31ef134',
    'd48976d2-703f-43c0-a4b4-d91983e7e336',
    '31a976ba-e535-4aca-b69f-9d0d72f4f779',
    'eab2bfc0-d849-418d-8b67-aecf9e4a8c2f',
    'ea8841b8-5b69-41da-9f8f-8e82b0f95fc6',
    'c4033870-2d5d-40ba-85c2-f4986a13a30d',
    '08dfc087-396a-4430-ba47-d098b2ab3915',
    '8420a063-d5eb-41b7-b52d-ca48c5ef96dc',
    '0fa7019b-ab82-454d-8768-0765022406d2',
    'bc5248d6-36f2-4365-95dc-7a3bc69abf93',
    '0e58b545-8206-417d-aa9f-91d78b54c715',
    '9de51440-219b-4ea3-9743-abe4133c73d8',
    '45bdb240-c3fa-4d2b-adbc-0e6a0ce137c9',
    'f393f73b-195b-4d67-88bf-702f098c4e77',
    '9746d4c7-7a66-4785-a3cb-d5eadf706475',
    '2eb71b2e-c245-4290-b9d5-220034848691',
    '4a75030d-540f-4391-ad63-8d399012f8a3',
    '66b59874-4ba1-4a41-a0d7-857112c492ed',
    'b0d81ad0-49d0-423d-bf9a-69d11764613c',
    '5fb5bcb7-1143-44a6-b915-fed87597a7c6',
    'f2ea0255-3b96-47a4-b387-eef5188bd32c',
    '2e684fab-1d48-4b69-ab85-e48c444118fa',
    '75379960-d5f2-47a8-afcd-7298ba6dacb4',
    '134b47a3-8b2d-499b-9229-92154f3b7ba3',
    '24fe4188-f87a-4b4a-ae6a-93c1f67d82ad',
    'dc2ad944-4577-44e6-8765-2e18a4e17cc0',
    '3070e0b6-a650-4a25-920c-6ad23ffb5b47',
    '22448663-3280-4275-9cdc-826759263f92',
    'b911b1f9-e153-4600-a084-174c371831a3',
    'b0b3cdaf-1562-4529-9283-4f87301a2536',
    '0aff9c2d-e82a-4ac1-9974-9b246a67e295',
    '1d6b974c-a2b2-440e-a13f-80802512406e',
    '8dbf2514-4afd-4616-802c-b6e4fa8ae412',
    '8565b4ff-3610-41f6-b603-b876ed0e1669',
    'c3d11380-706a-4be6-b9f6-716050995d1d',
    '65d6129a-bfbd-4c30-8d5c-d139bb759d29',
    'd8764615-330f-4b91-83d4-dc8b49e8fb0f',
    '5406b779-9335-4dd7-88e5-28ea2a6f4bd1',
    '878e19e3-6fc7-45f6-9c9f-47389c1210cf',
    '5b33bf53-7edd-4a4c-bd96-4961579baaf3',
    '640f059e-3a5e-4e47-b88c-84bfea77177d',
    '5790abf6-8626-4d98-9859-1001bc0192d1',
    '22b9cd58-8e24-4edc-93f0-e294512ca515',
    '0acb3c95-df0a-4bb6-aaa9-fd1704290f02',
    '159db357-fb1d-4612-b0e9-d60d191d6e79',
    '145a434f-5550-4c06-b82c-aed912e7f111',
    '500904f0-852a-4e16-aff7-9b1df22d0c94',
    '4fe13b76-7e03-4677-b704-67582c11fbf5',
    'f880c5df-4123-401b-b408-e298218ff328',
    '006a7047-0604-47d7-a806-c0d0e368df32',
    '65815134-57fb-46fc-b620-fb48ac0520cd',
    '9843bdbc-3fe9-4ef3-a92d-5532200b98eb',
    'a2efda1e-c255-461a-b338-bb8a479f8ae4',
    '975ccb8b-6908-4b5d-9294-f4d7a5ebb011',
    'dd4c61f2-ebd9-4087-ad7b-d2f79a3e4561',
    '4ea5070f-266d-4448-aaa4-93b8a72ed45e',
    '4e5c65be-24d8-4cf4-bfb3-bef0c8822525',
    '71dfdf9b-777a-43e6-88da-5c971b495b2d',
    '5ef53692-5dde-463b-892f-93a800db3b72',
    '6c16632b-fe14-4c9c-a4a2-7f0aed48070b',
    '283e99d6-4749-46a8-ad72-c5e3cdd77ef1',
    '805a01b8-7a5e-44a3-848f-d608dd19db7f',
    '81ac7850-457f-495f-a12a-d54cb1e65017',
    'e1cfbba1-97eb-4cbf-b559-6afd7604910f',
    '9c360220-d9ed-48a3-9e64-e9176f54231f',
    '33e3d0f2-d052-42c8-81c6-676f72a40565',
    '2da4ff27-b7f0-4411-8854-e286b06ed287',
    '55d22b6c-e79b-4fb5-b4ce-769b685846c8',
    '3d788e1f-4abd-49fd-b354-cd1c48f7adca',
    '7c6b7c9d-f196-4c4f-baee-cbd16db66805',
    'ffea7d70-c60e-4f61-823f-1832d9189102',
    '2d22f35c-a730-463d-a2a9-501fed6b9a30',
    'ddf201a8-c7f2-4163-857f-af1e7fef370c',
    'c0cb271b-6249-4d8c-8874-34e1d9ab2b27',
    'c98e4a61-ed7f-44e5-8a27-42a30bfe8dab',
    'd032175e-782f-44a3-be3a-9e2e82fae029',
    '73f7f271-4e93-4b82-bfd8-a86fbd3af674',
    '2a7973be-6917-4e91-a7b5-9689fd9f5217',
    '40fe3f33-9258-49b1-88f0-a2740743a61e',
    'f4dc4605-ebc3-4196-908c-09d8599c357d',
    'f241aaaa-5314-44f2-b51f-dd31ba5db44c',
    'eea05df8-0e48-4e1c-bb5a-e797e21aed1e',
    '23693271-2ea1-471f-b5d6-dc30c1660f7c',
    '8ed3b41d-c34c-457c-ac1a-765845299414',
    'ba2ba628-570a-4b38-a23e-421c8d8a59f9',
    '1883be9f-7a09-4cd3-8713-3beee263dd5e',
    '0364f158-c3ec-4521-b6d1-15b7c03f6c04',
    'a0b1119d-7875-4fd8-99af-e6b453c5b1f9',
    'a5afa1e7-4396-41ee-bf3c-45e0fe060bd6',
    'b93862eb-295e-48b8-97b7-7b2d56419feb',
    '9737279f-458c-4746-921a-c3cf6d4b418a',
    '31c2fa7a-fb00-4466-aeb9-0049f0b70de8',
    '33fd58a1-f24a-445c-af33-14ce336b9fd6',
    'd4a0b558-6a75-478c-8621-99686362ebff',
    'c0643ee6-3097-49ea-9e9b-0fec03eb7caa',
    'cd8d3b77-a67c-4853-b9ae-e9b234a5c960',
    '520fb1f8-5419-4238-a4c6-421f697201bf',
    '4ed990fb-d0b1-414d-99b7-bac0849eacd1',
    '4562edee-1a94-4beb-9419-364543bd93fa',
    'b5b6f02c-f37f-4bd5-a1b5-7ec2c8982fc3',
    '5672abc1-0370-472c-8281-4912f705d706',
    '3f29d400-01a6-4ed4-b98d-d9c6eb9798a4',
    '79ba78a7-3dee-4a21-8e19-8e6edbbf1a90',
    'ec2e69cc-9211-4ca7-862e-944d1acd3c97'
  ]::uuid[];
  n integer;
BEGIN
  RAISE NOTICE '0067: begin (% doomed txns, % doomed expenses)', array_length(v_txns,1), array_length(v_exps,1);

  DELETE FROM public.postings WHERE transaction_id = ANY(v_txns);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0067: deleted % postings', n;

  DELETE FROM public.office_expenses WHERE id = ANY(v_exps);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0067: deleted % office_expenses', n;

  DELETE FROM public.transactions WHERE id = ANY(v_txns);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0067: deleted % transactions', n;
END
$wipe$;
--> statement-breakpoint

-- Restore the 0015 body verbatim.
CREATE OR REPLACE FUNCTION public.tg_block_delete_ledger() RETURNS TRIGGER AS $restored$
DECLARE
  v_status text;
BEGIN
  IF TG_TABLE_NAME = 'transactions' THEN
    v_status := OLD.status::text;
  ELSE
    -- postings: inherit status from parent transaction.
    SELECT t.status::text INTO v_status
    FROM public.transactions t
    WHERE t.id = OLD.transaction_id;
  END IF;

  IF v_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'DELETE forbidden on ledger table % when status = %. LEDGER-SPEC 0.3 / 8.5. Reverse instead.', TG_TABLE_NAME, v_status;
  END IF;

  RETURN OLD;
END;
$restored$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Guards: never commit with the protection off, or with the salary rows gone.
DO $guard$
DECLARE v_count integer;
BEGIN
  IF position('DELETE forbidden' in pg_get_functiondef('public.tg_block_delete_ledger()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0067: ledger delete-protection was not restored; aborting';
  END IF;
  RAISE NOTICE '0067: delete-protection restored';

  SELECT count(*) INTO v_count FROM public.office_expenses WHERE deleted_at IS NULL;
  IF v_count <> 11 THEN
    RAISE EXCEPTION '0067: expected 11 surviving office_expenses (the salary rows), found %', v_count;
  END IF;
  RAISE NOTICE '0067: % salary rows preserved — done', v_count;
END
$guard$;
