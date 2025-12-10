/*
  Warnings:

  - You are about to drop the column `servicoId` on the `Cotacao` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Cotacao" DROP CONSTRAINT "Cotacao_servicoId_fkey";

-- AlterTable
ALTER TABLE "Cotacao" DROP COLUMN "servicoId",
ADD COLUMN     "cotacaoUsdtBrl" DOUBLE PRECISION,
ADD COLUMN     "moeda" TEXT NOT NULL DEFAULT 'BRL';

-- CreateTable
CREATE TABLE "CotacaoServico" (
    "id" TEXT NOT NULL,
    "cotacaoId" TEXT NOT NULL,
    "servicoId" TEXT NOT NULL,
    "valorVenda" DOUBLE PRECISION NOT NULL,
    "custo" DOUBLE PRECISION NOT NULL,
    "margem" DOUBLE PRECISION NOT NULL,
    "comissaoPercent" DOUBLE PRECISION NOT NULL,
    "comissao" DOUBLE PRECISION NOT NULL,
    "moeda" TEXT NOT NULL DEFAULT 'BRL',
    "ordem" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CotacaoServico_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CotacaoServico" ADD CONSTRAINT "CotacaoServico_cotacaoId_fkey" FOREIGN KEY ("cotacaoId") REFERENCES "Cotacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotacaoServico" ADD CONSTRAINT "CotacaoServico_servicoId_fkey" FOREIGN KEY ("servicoId") REFERENCES "Servico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
