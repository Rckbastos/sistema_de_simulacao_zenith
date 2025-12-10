require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fetchFn = global.fetch || require('node-fetch');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient, Prisma } = require('@prisma/client');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not configured');
}

const shouldUseSSL = (() => {
  if ((process.env.DATABASE_SSL || '').toLowerCase() === 'true') {
    return true;
  }
  try {
    const parsed = new URL(DATABASE_URL);
    return parsed.hostname.includes('.proxy.rlwy.net');
  } catch (error) {
    return false;
  }
})();

const poolConfig = { connectionString: DATABASE_URL };
if (shouldUseSSL) {
  poolConfig.ssl = { rejectUnauthorized: false };
}
const pool = new Pool(poolConfig);
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const FX_CACHE_MS = Math.max(30000, Number(process.env.RATE_CACHE_MS || 60000));
const FX_TIMEOUT_MS = Math.max(5000, Number(process.env.RATE_TIMEOUT_MS || 8000));
const EXCHANGE_RATE_API_KEY = process.env.EXCHANGE_RATE_API_KEY?.trim();
const EXCHANGE_RATE_BASE = 'USD';
const EXCHANGE_RATE_FALLBACK_URL = `https://open.er-api.com/v6/latest/${EXCHANGE_RATE_BASE}`;
const EXCHANGE_RATE_URL = process.env.EXCHANGE_RATE_API_URL?.trim()
  || (EXCHANGE_RATE_API_KEY
    ? `https://v6.exchangerate-api.com/v6/${EXCHANGE_RATE_API_KEY}/latest/${EXCHANGE_RATE_BASE}`
    : EXCHANGE_RATE_FALLBACK_URL);
const FX_HEADERS = {
  'User-Agent': 'SistemaSimulacaoZenith/1.0 (+railway.app)',
  Accept: 'application/json'
};
const USD_USDT_FALLBACK = Number(process.env.USD_USDT_FALLBACK || 1);
let tickerCache = { expires: 0, data: null };

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const ROOT = __dirname;

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

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const normalizePermissions = (perms = {}) => {
  const normalized = { ...DEFAULT_PERMISSIONS };
  Object.keys(normalized).forEach(key => {
    if (Object.prototype.hasOwnProperty.call(perms, key)) {
      normalized[key] = Boolean(perms[key]);
    }
  });

  if (normalized.adminMaster) {
    Object.keys(normalized).forEach(key => {
      normalized[key] = true;
    });
    normalized.adminMaster = true;
  }

  return normalized;
};

const buildToken = payload =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });

const isAdminUser = user => user?.tipo === 'admin' || user?.permissoes?.adminMaster;

const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Não autenticado' });
  }

  try {
    const token = header.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);
    let userPayload = decoded;

    if (decoded?.tipo === 'comercial' && !decoded?.permissoes?.adminMaster) {
      const comercial = await prisma.comercial.findUnique({ where: { id: decoded.id } });
      if (!comercial) {
        return res.status(401).json({ message: 'Sessão inválida. Faça login novamente.' });
      }
      if (comercial.kycStatus !== 'APROVADO') {
        return res.status(403).json({ message: 'Seu cadastro ainda não foi aprovado pelo KYC.' });
      }
      userPayload = {
        id: comercial.id,
        nome: comercial.nome,
        tipo: 'comercial',
        permissoes: normalizePermissions(comercial.permissoes || {}),
        kycStatus: comercial.kycStatus
      };
    }

    req.user = userPayload;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Sessão expirada' });
  }
});

const hasPermission = (user, permissionKey) => {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  if (!permissionKey) return false;
  return Boolean(user.permissoes?.[permissionKey]);
};

const requirePermission = permissionKey => (req, res, next) => {
  if (!hasPermission(req.user, permissionKey)) {
    return res.status(403).json({ message: 'Você não tem permissão para executar esta ação.' });
  }
  next();
};

const adminOnly = requirePermission('adminMaster');

const KYC_STATUSES = ['PENDENTE', 'APROVADO', 'REPROVADO'];
const parseKycStatus = value => {
  if (!value && value !== 0) return null;
  const normalized = value.toString().trim().toUpperCase();
  return KYC_STATUSES.includes(normalized) ? normalized : null;
};

const safeComercial = comercial => {
  if (!comercial) return null;
  const { senhaHash, ...rest } = comercial;
  return { ...rest, permissoes: normalizePermissions(comercial.permissoes) };
};

const includeCotacaoRelations = {
  cliente: true,
  comercial: { select: { id: true, nome: true } },
  itens: {
    include: { servico: true },
    orderBy: { ordem: 'asc' }
  }
};

const mapCotacao = cotacao => ({
  ...cotacao,
  clienteNome: cotacao.cliente?.nome,
  comercialNome: cotacao.comercial?.nome,
  itens: (cotacao.itens || []).map(item => ({
    ...item,
    servicoNome: item.servico?.nome
  }))
});

const divide = (numerator, denominator) => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
};

const invert = value => {
  if (!Number.isFinite(value) || value === 0) return null;
  return 1 / value;
};

const normalizarMoeda = value => {
  const normalized = (value || 'BRL').toString().trim().toUpperCase();
  if (!normalized) return 'BRL';
  const allowed = ['BRL', 'USD'];
  return allowed.includes(normalized) ? normalized : 'BRL';
};

const fetchExchangeTicker = async () => {
  const now = Date.now();
  if (tickerCache.data && tickerCache.expires > now) {
    return tickerCache.data;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FX_TIMEOUT_MS);

  let response;
  try {
    response = await fetchFn(EXCHANGE_RATE_URL, { headers: FX_HEADERS, signal: controller.signal });
  } catch (fetchError) {
    console.error('Erro de rede ao consultar a ExchangeRate-API', fetchError);
    throw new Error('Falha ao consultar a ExchangeRate-API (rede indisponível)');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error('ExchangeRate-API respondeu com erro', response.status, body);
    throw new Error(`Falha ao consultar a ExchangeRate-API (${response.status})`);
  }

  const payload = await response.json();
  const rates = payload?.conversion_rates || payload?.rates;
  if (!rates || typeof rates !== 'object') {
    throw new Error('Resposta inválida da ExchangeRate-API (sem taxas)');
  }
  const usdBrlRaw = Number(rates?.BRL);
  const usdUsdtRaw = Number(rates?.USDT);

  if (!Number.isFinite(usdBrlRaw)) {
    throw new Error('Resposta inválida da ExchangeRate-API (sem taxa BRL)');
  }

  const usdBrl = usdBrlRaw;
  let usdUsdt = Number.isFinite(usdUsdtRaw) ? usdUsdtRaw : null;
  if (!usdUsdt && Number.isFinite(USD_USDT_FALLBACK)) {
    usdUsdt = USD_USDT_FALLBACK;
  }
  const usdtBrl = (usdUsdt ? divide(usdBrl, usdUsdt) : null);

  const brlUsd = invert(usdBrl);
  const brlUsdt = invert(usdtBrl);

  const data = {
    usdBrl,
    usdtBrl,
    brlUsd,
    usdUsdt,
    brlUsdt,
    provider: 'ExchangeRate-API',
    updatedAt: new Date().toISOString()
  };

  tickerCache = { data, expires: now + FX_CACHE_MS };
  return data;
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/cotacoes/ticker', asyncHandler(async (req, res) => {
  try {
    const ticker = await fetchExchangeTicker();
    res.json(ticker);
  } catch (error) {
    console.error('Erro ao buscar cotações', error);
    res.status(502).json({ message: 'Não foi possível obter cotações no momento.' });
  }
}));

app.post('/auth/login', asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ message: 'Credenciais obrigatórias' });
  }

  if (identifier === ADMIN_USER) {
    if (password !== ADMIN_PASS) {
      return res.status(401).json({ message: 'Usuário ou senha inválidos' });
    }

    const adminPayload = {
      id: 'admin',
      nome: 'Administrador',
      tipo: 'admin',
      permissoes: normalizePermissions({ adminMaster: true })
    };
    const token = buildToken(adminPayload);
    return res.json({ token, user: adminPayload });
  }

  const comercial = await prisma.comercial.findFirst({
    where: {
      OR: [{ cpf: identifier }, { pix: identifier }]
    }
  });

  if (!comercial) {
    return res.status(401).json({ message: 'Usuário ou senha inválidos' });
  }

  const ok = await bcrypt.compare(password, comercial.senhaHash);
  if (!ok) {
    return res.status(401).json({ message: 'Usuário ou senha inválidos' });
  }

  if (comercial.kycStatus !== 'APROVADO') {
    return res.status(403).json({ message: 'Seu cadastro ainda não foi aprovado pelo KYC.' });
  }

  const payload = {
    id: comercial.id,
    nome: comercial.nome,
    tipo: 'comercial',
    permissoes: normalizePermissions(comercial.permissoes || {}),
    kycStatus: comercial.kycStatus
  };
  const token = buildToken(payload);
  res.json({ token, user: payload });
}));

app.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// Servicos
app.get('/servicos', authenticate, asyncHandler(async (req, res) => {
  const servicos = await prisma.servico.findMany({ orderBy: { nome: 'asc' } });
  res.json(servicos);
}));

app.post('/servicos', authenticate, requirePermission('adminServicos'), asyncHandler(async (req, res) => {
  const { nome, tipoCusto, valor, status } = req.body;
  const servico = await prisma.servico.create({
    data: {
      nome,
      tipoCusto,
      valor: parseFloat(valor) || 0,
      status: status || 'ativo'
    }
  });
  res.status(201).json(servico);
}));

app.put('/servicos/:id', authenticate, requirePermission('adminServicos'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { nome, tipoCusto, valor, status } = req.body;
  const servico = await prisma.servico.update({
    where: { id },
    data: { nome, tipoCusto, valor: parseFloat(valor) || 0, status }
  });
  res.json(servico);
}));

app.delete('/servicos/:id', authenticate, requirePermission('adminServicos'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const vinculos = await prisma.cotacaoServico.count({ where: { servicoId: id } });
  if (vinculos > 0) {
    return res.status(409).json({
      message: 'Não é possível excluir este serviço porque existem cotações vinculadas a ele.'
    });
  }
  await prisma.servico.delete({ where: { id } });
  res.status(204).end();
}));

// Clientes
app.get('/clientes', authenticate, asyncHandler(async (req, res) => {
  const clientes = await prisma.cliente.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(clientes);
}));

app.post('/clientes', authenticate, asyncHandler(async (req, res) => {
  const { nome, documento, email, telefone, endereco, observacoes } = req.body;
  const cliente = await prisma.cliente.create({
    data: { nome, documento, email, telefone, endereco, observacoes }
  });
  res.status(201).json(cliente);
}));

app.put('/clientes/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { nome, documento, email, telefone, endereco, observacoes } = req.body;
  const cliente = await prisma.cliente.update({
    where: { id },
    data: { nome, documento, email, telefone, endereco, observacoes }
  });
  res.json(cliente);
}));

app.delete('/clientes/:id', authenticate, requirePermission('clientes'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const vinculos = await prisma.cotacao.count({ where: { clienteId: id } });
  if (vinculos > 0) {
    return res.status(409).json({
      message: 'Não é possível excluir este cliente porque existem cotações vinculadas a ele.'
    });
  }
  await prisma.cliente.delete({ where: { id } });
  res.status(204).end();
}));

// Comerciais
app.get('/comerciais', authenticate, requirePermission('comerciais'), asyncHandler(async (req, res) => {
  const comerciais = await prisma.comercial.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(comerciais.map(safeComercial));
}));

app.post('/comerciais', authenticate, requirePermission('comerciais'), asyncHandler(async (req, res) => {
  const { nome, cpf, pix, status, senha, permissoes, documentoUrl, selfieUrl } = req.body;
  if (!senha) {
    return res.status(400).json({ message: 'Senha obrigatória' });
  }
  const senhaHash = await bcrypt.hash(senha, 10);
  const comercial = await prisma.comercial.create({
    data: {
      nome,
      cpf,
      pix,
      status: status || 'ativo',
      senhaHash,
      permissoes: normalizePermissions(permissoes || {}),
      documentoUrl,
      selfieUrl,
      kycStatus: 'PENDENTE',
      kycObservacao: null,
      kycRevisorId: null,
      kycRevisorNome: null,
      kycRevisadoEm: null
    }
  });
  res.status(201).json(safeComercial(comercial));
}));

app.put('/comerciais/:id', authenticate, requirePermission('comerciais'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { nome, cpf, pix, status, senha, permissoes, documentoUrl, selfieUrl } = req.body;
  const current = await prisma.comercial.findUnique({ where: { id } });
  if (!current) {
    return res.status(404).json({ message: 'Comercial não encontrado' });
  }
  const data = {
    nome,
    cpf,
    pix,
    status,
    permissoes: normalizePermissions(permissoes || {}),
  };
  if (typeof documentoUrl !== 'undefined') {
    data.documentoUrl = documentoUrl;
  }
  if (typeof selfieUrl !== 'undefined') {
    data.selfieUrl = selfieUrl;
  }
  if (senha) {
    data.senhaHash = await bcrypt.hash(senha, 10);
  }
  const documentoAlterado = typeof documentoUrl !== 'undefined' && documentoUrl !== current.documentoUrl;
  const selfieAlterada = typeof selfieUrl !== 'undefined' && selfieUrl !== current.selfieUrl;
  if (documentoAlterado || selfieAlterada) {
    Object.assign(data, {
      kycStatus: 'PENDENTE',
      kycObservacao: null,
      kycRevisorId: null,
      kycRevisorNome: null,
      kycRevisadoEm: null
    });
  }
  const comercial = await prisma.comercial.update({ where: { id }, data });
  res.json(safeComercial(comercial));
}));

app.delete('/comerciais/:id', authenticate, requirePermission('comerciais'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const vinculos = await prisma.cotacao.count({ where: { comercialId: id } });
  if (vinculos > 0) {
    return res.status(409).json({
      message: 'Não é possível excluir este comercial porque existem cotações vinculadas a ele.'
    });
  }
  await prisma.comercial.delete({ where: { id } });
  res.status(204).end();
}));

// KYC
app.get('/kyc/comerciais', authenticate, adminOnly, asyncHandler(async (req, res) => {
  const statusFilter = parseKycStatus(req.query.status);
  const where = statusFilter ? { kycStatus: statusFilter } : {};
  const comerciais = await prisma.comercial.findMany({
    where,
    orderBy: [{ kycStatus: 'asc' }, { createdAt: 'asc' }]
  });
  res.json(comerciais.map(safeComercial));
}));

app.patch('/kyc/comerciais/:id', authenticate, adminOnly, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, observacao } = req.body;
  const kycStatus = parseKycStatus(status);
  if (!kycStatus) {
    return res.status(400).json({ message: 'Status de KYC inválido.' });
  }
  const data = {
    kycStatus,
    kycObservacao: observacao?.toString().trim() || null,
    kycRevisorId: kycStatus === 'PENDENTE' ? null : req.user.id,
    kycRevisorNome: kycStatus === 'PENDENTE' ? null : req.user.nome,
    kycRevisadoEm: kycStatus === 'PENDENTE' ? null : new Date()
  };
  const comercial = await prisma.comercial.update({ where: { id }, data });
  res.json(safeComercial(comercial));
}));

// Cotações
app.get('/cotacoes', authenticate, asyncHandler(async (req, res) => {
  const status = req.query.status;
  const base = isAdminUser(req.user)
    ? await prisma.cotacao.findMany({ include: includeCotacaoRelations, orderBy: { createdAt: 'desc' } })
    : await prisma.cotacao.findMany({
        where: { comercialId: req.user.id || undefined },
        include: includeCotacaoRelations,
        orderBy: { createdAt: 'desc' }
      });

  const filtered = status ? base.filter(c => c.status === status) : base;
  res.json(filtered.map(mapCotacao));
}));

app.post('/cotacoes', authenticate, asyncHandler(async (req, res) => {
  const {
    clienteId,
    comissaoPercent,
    observacoes,
    status,
    itens: itensEntrada = [],
    moeda,
    cotacaoUsdtBrl
  } = req.body;

  if (!clienteId) {
    return res.status(400).json({ message: 'Cliente é obrigatório.' });
  }

  if (!Array.isArray(itensEntrada) || itensEntrada.length === 0) {
    return res.status(400).json({ message: 'Informe ao menos um serviço na cotação.' });
  }

  const itensLimitados = itensEntrada.slice(0, 3);
  const servicoIds = itensLimitados.map(item => item?.servicoId).filter(Boolean);
  if (servicoIds.length !== itensLimitados.length) {
    return res.status(400).json({ message: 'Serviço inválido na cotação.' });
  }

  const servicosDb = await prisma.servico.findMany({ where: { id: { in: servicoIds } } });
  if (servicosDb.length !== servicoIds.length) {
    return res.status(400).json({ message: 'Um dos serviços informados não existe.' });
  }

  const normalizedMoeda = normalizarMoeda(moeda);
  const comPercent = Number.isFinite(Number(comissaoPercent)) ? Number(comissaoPercent) : 0;
  const comPercentDecimal = comPercent / 100;

  const itensCalculados = itensLimitados.map((item, index) => {
    const servico = servicosDb.find(s => s.id === item.servicoId);
    const valorVendaItem = Number(item.valorVenda);
    if (!servico || !Number.isFinite(valorVendaItem) || valorVendaItem <= 0) {
      throw new Error('Valor de venda inválido para o serviço.');
    }
    const custoCalculado = servico.tipoCusto === 'percentual'
      ? valorVendaItem * (servico.valor / 100)
      : servico.valor;
    const margemCalculada = valorVendaItem - custoCalculado;
    const comissaoCalculada = valorVendaItem * comPercentDecimal;
    return {
      servicoId: servico.id,
      valorVenda: valorVendaItem,
      custo: custoCalculado,
      margem: margemCalculada,
      comissaoPercent: comPercent,
      comissao: comissaoCalculada,
      moeda: normalizedMoeda,
      ordem: index + 1
    };
  });

  const totais = itensCalculados.reduce(
    (acc, item) => {
      acc.valor += item.valorVenda;
      acc.custo += item.custo;
      acc.margem += item.margem;
      acc.comissao += item.comissao;
      return acc;
    },
    { valor: 0, custo: 0, margem: 0, comissao: 0 }
  );

  const data = {
    clienteId,
    valorVenda: totais.valor,
    custo: totais.custo,
    margem: totais.margem,
    comissaoPercent: comPercent,
    comissao: totais.comissao,
    observacoes,
    status: status || 'analise',
    moeda: normalizedMoeda,
    cotacaoUsdtBrl: Number.isFinite(Number(cotacaoUsdtBrl)) ? Number(cotacaoUsdtBrl) : null
  };

  if (!isAdminUser(req.user)) {
    data.comercialId = req.user.id;
  } else if (req.body.comercialId) {
    data.comercialId = req.body.comercialId;
  }

  const cotacao = await prisma.cotacao.create({
    data: {
      ...data,
      itens: {
        create: itensCalculados
      }
    },
    include: includeCotacaoRelations
  });
  res.status(201).json(mapCotacao(cotacao));
}));

app.patch('/cotacoes/:id/status', authenticate, asyncHandler(async (req, res) => {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ message: 'Apenas administradores podem alterar o status de cotações.' });
  }

  const { id } = req.params;
  const { status } = req.body;
  const existing = await prisma.cotacao.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ message: 'Cotação não encontrada' });
  }

  const cotacao = await prisma.cotacao.update({
    where: { id },
    data: { status },
    include: includeCotacaoRelations
  });
  res.json(mapCotacao(cotacao));
}));

app.delete('/cotacoes/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.cotacao.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ message: 'Cotação não encontrada' });
  }
  if (!isAdminUser(req.user) && existing.comercialId !== req.user.id) {
    return res.status(403).json({ message: 'Sem permissão para excluir esta cotação' });
  }
  await prisma.cotacao.delete({ where: { id } });
  res.status(204).end();
}));

// Static files
app.use(express.static(ROOT));
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT, 'sistema_de_simulacao_zenith.html'));
});
app.get('/mobile', (req, res) => {
  res.sendFile(path.join(ROOT, 'sistema_de_simulacao_zenith_mobile.html'));
});

app.use((err, req, res, next) => {
  console.error(`[${req.method} ${req.originalUrl}]`, err);

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'Já existe um registro utilizando estes dados.' });
    }
    if (err.code === 'P2003') {
      return res.status(409).json({ message: 'Não é possível concluir a operação porque existem registros vinculados.' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Registro não encontrado.' });
    }
  }

  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ message: 'Corpo da requisição inválido.' });
  }

  res.status(500).json({ message: 'Erro interno no servidor' });
});

const shutdown = signal => {
  console.log(`Encerrando servidor (${signal})...`);
  Promise.allSettled([prisma.$disconnect(), pool.end()])
    .finally(() => process.exit(0));
};

['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => shutdown(signal));
});

app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
