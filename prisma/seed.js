const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const DEFAULT_PERMISSIONS = {
  dashboard: true,
  novaCotacao: true,
  cotacoesAbertas: true,
  cotacoesFechadas: true,
  clientes: true,
  comerciais: false,
  adminServicos: false,
  adminMaster: false
};

const normalizePermissions = (perms = {}) => {
  const normalized = { ...DEFAULT_PERMISSIONS };
  Object.keys(normalized).forEach(key => {
    if (Object.prototype.hasOwnProperty.call(perms, key)) {
      normalized[key] = Boolean(perms[key]);
    }
  });
  if (normalized.adminMaster) {
    Object.keys(normalized).forEach(key => (normalized[key] = true));
    normalized.adminMaster = true;
  }
  return normalized;
};

async function main() {
  const servicosSeed = [
    { id: 'svc-pix-usdt', nome: 'Conversão de Pix para Usdt', tipoCusto: 'percentual', valor: 3, status: 'ativo' },
    { id: 'svc-usdt-pix', nome: 'Conversão Usdt para Pix', tipoCusto: 'percentual', valor: 3, status: 'ativo' },
    { id: 'svc-chao-pix', nome: 'Bancarizar Chão para Pix', tipoCusto: 'fixo', valor: 0, status: 'ativo' },
    { id: 'svc-chao-usdt', nome: 'Bancarizar Chão para Usdt', tipoCusto: 'fixo', valor: 0, status: 'ativo' },
    { id: 'svc-pix-chao', nome: 'Pix para Chão', tipoCusto: 'fixo', valor: 0, status: 'ativo' },
    { id: 'svc-remessas', nome: 'Remessas Internacionais', tipoCusto: 'fixo', valor: 0, status: 'ativo' }
  ];

  for (const servico of servicosSeed) {
    await prisma.servico.upsert({
      where: { id: servico.id },
      update: servico,
      create: servico
    });
  }

  const clientesSeed = [
    {
      id: 'cli-ricardo-bastos',
      nome: 'Ricardo Augusto de Lima Bastos',
      documento: '41140511000196',
      email: 'ricardo@zenithpay.com.br',
      telefone: '44998770331',
      endereco: 'Curitiba - PR',
      observacoes: 'Cliente estratégico'
    }
  ];

  for (const cliente of clientesSeed) {
    await prisma.cliente.upsert({
      where: { id: cliente.id },
      update: cliente,
      create: cliente
    });
  }

  const comerciaisSeed = [
    {
      id: 'com-ricardo',
      nome: 'Ricardo Augusto De L Bastos',
      cpf: '140.441.327-80',
      pix: 'ricardoaugusto@zenithpay.com.br',
      status: 'ativo',
      senha: 'senha123',
      permissoes: normalizePermissions({
        dashboard: true,
        novaCotacao: true,
        cotacoesAbertas: true,
        cotacoesFechadas: true,
        clientes: true,
        comerciais: true,
        adminServicos: true
      })
    }
  ];

  for (const comercial of comerciaisSeed) {
    const senhaHash = await bcrypt.hash(comercial.senha, 10);
    await prisma.comercial.upsert({
      where: { id: comercial.id },
      update: {
        nome: comercial.nome,
        cpf: comercial.cpf,
        pix: comercial.pix,
        status: comercial.status,
        senhaHash,
        permissoes: comercial.permissoes
      },
      create: {
        id: comercial.id,
        nome: comercial.nome,
        cpf: comercial.cpf,
        pix: comercial.pix,
        status: comercial.status,
        senhaHash,
        permissoes: comercial.permissoes
      }
    });
  }

  const cotacoesSeed = [
    {
      id: 'cot-analise',
      clienteId: 'cli-ricardo-bastos',
      servicoId: 'svc-pix-usdt',
      comercialId: 'com-ricardo',
      valorVenda: 100000,
      custo: 3000,
      margem: 97000,
      comissaoPercent: 3,
      comissao: 3000,
      observacoes: 'Cotação inicial para operação em Pix',
      status: 'analise'
    },
    {
      id: 'cot-fechada',
      clienteId: 'cli-ricardo-bastos',
      servicoId: 'svc-usdt-pix',
      comercialId: 'com-ricardo',
      valorVenda: 50000,
      custo: 1500,
      margem: 48500,
      comissaoPercent: 2.5,
      comissao: 1250,
      observacoes: 'Operação concluída',
      status: 'fechada'
    }
  ];

  for (const cotacao of cotacoesSeed) {
    await prisma.cotacao.upsert({
      where: { id: cotacao.id },
      update: cotacao,
      create: cotacao
    });
  }

  console.log('Seed executado com sucesso');
}

main()
  .catch(error => {
    console.error('Erro no seed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
