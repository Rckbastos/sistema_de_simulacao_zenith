-- Add columns for invoice/banking details to Cliente
ALTER TABLE "Cliente"
ADD COLUMN IF NOT EXISTS "contato" TEXT,
ADD COLUMN IF NOT EXISTS "invoicePaymentTerms" TEXT,
ADD COLUMN IF NOT EXISTS "invoiceDeliveryTerms" TEXT,
ADD COLUMN IF NOT EXISTS "countryOfOrigin" TEXT,
ADD COLUMN IF NOT EXISTS "hsCode" TEXT,
ADD COLUMN IF NOT EXISTS "deliveryInfo" TEXT,
ADD COLUMN IF NOT EXISTS "shippingMethod" TEXT,
ADD COLUMN IF NOT EXISTS "bankName" TEXT,
ADD COLUMN IF NOT EXISTS "bankSwift" TEXT,
ADD COLUMN IF NOT EXISTS "bankBranch" TEXT,
ADD COLUMN IF NOT EXISTS "bankAccount" TEXT,
ADD COLUMN IF NOT EXISTS "bankBeneficiary" TEXT,
ADD COLUMN IF NOT EXISTS "bankBeneficiaryAddress" TEXT,
ADD COLUMN IF NOT EXISTS "intermediaryBank" TEXT,
ADD COLUMN IF NOT EXISTS "intermediarySwift" TEXT;
