-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('PENDENTE', 'APROVADO', 'REPROVADO');

-- AlterTable
ALTER TABLE "Comercial" ADD COLUMN     "kycObservacao" TEXT,
ADD COLUMN     "kycRevisadoEm" TIMESTAMP(3),
ADD COLUMN     "kycRevisorId" TEXT,
ADD COLUMN     "kycRevisorNome" TEXT,
ADD COLUMN     "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDENTE';
