require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
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
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Sessão expirada' });
  }
});

const adminOnly = (req, res, next) => {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ message: 'Acesso restrito ao administrador' });
  }
  next();
};

const safeComercial = comercial => {
  if (!comercial) return null;
  const { senhaHash, ...rest } = comercial;
  return { ...rest, permissoes: normalizePermissions(comercial.permissoes) };
};

const includeCotacaoRelations = {
  cliente: true,
  servico: true,
  comercial: { select: { id: true, nome: true } }
};

const mapCotacao = cotacao => ({
  ...cotacao,
  clienteNome: cotacao.cliente?.nome,
  servicoNome: cotacao.servico?.nome,
  comercialNome: cotacao.comercial?.nome
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

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

  const payload = {
    id: comercial.id,
    nome: comercial.nome,
    tipo: 'comercial',
    permissoes: normalizePermissions(comercial.permissoes || {})
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

app.post('/servicos', authenticate, adminOnly, asyncHandler(async (req, res) => {
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

app.put('/servicos/:id', authenticate, adminOnly, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { nome, tipoCusto, valor, status } = req.body;
  const servico = await prisma.servico.update({
    where: { id },
    data: { nome, tipoCusto, valor: parseFloat(valor) || 0, status }
  });
  res.json(servico);
}));

app.delete('/servicos/:id', authenticate, adminOnly, asyncHandler(async (req, res) => {
  const { id } = req.params;
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

app.delete('/clientes/:id', authenticate, adminOnly, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await prisma.cliente.delete({ where: { id } });
  res.status(204).end();
}));

// Comerciais
app.get('/comerciais', authenticate, adminOnly, asyncHandler(async (req, res) => {
  const comerciais = await prisma.comercial.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(comerciais.map(safeComercial));
}));

app.post('/comerciais', authenticate, adminOnly, asyncHandler(async (req, res) => {
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
      selfieUrl
    }
  });
  res.status(201).json(safeComercial(comercial));
}));

app.put('/comerciais/:id', authenticate, adminOnly, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { nome, cpf, pix, status, senha, permissoes, documentoUrl, selfieUrl } = req.body;
  const data = {
    nome,
    cpf,
    pix,
    status,
    permissoes: normalizePermissions(permissoes || {}),
    documentoUrl,
    selfieUrl
  };
  if (senha) {
    data.senhaHash = await bcrypt.hash(senha, 10);
  }
  const comercial = await prisma.comercial.update({ where: { id }, data });
  res.json(safeComercial(comercial));
}));

app.delete('/comerciais/:id', authenticate, adminOnly, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await prisma.comercial.delete({ where: { id } });
  res.status(204).end();
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
    servicoId,
    valorVenda,
    custo,
    margem,
    comissaoPercent,
    comissao,
    observacoes,
    status
  } = req.body;

  const data = {
    clienteId,
    servicoId,
    valorVenda: parseFloat(valorVenda) || 0,
    custo: parseFloat(custo) || 0,
    margem: parseFloat(margem) || 0,
    comissaoPercent: parseFloat(comissaoPercent) || 0,
    comissao: parseFloat(comissao) || 0,
    observacoes,
    status: status || 'analise'
  };

  if (!isAdminUser(req.user)) {
    data.comercialId = req.user.id;
  } else if (req.body.comercialId) {
    data.comercialId = req.body.comercialId;
  }

  const cotacao = await prisma.cotacao.create({ data, include: includeCotacaoRelations });
  res.status(201).json(mapCotacao(cotacao));
}));

app.patch('/cotacoes/:id/status', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const existing = await prisma.cotacao.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ message: 'Cotação não encontrada' });
  }
  if (!isAdminUser(req.user) && existing.comercialId !== req.user.id) {
    return res.status(403).json({ message: 'Sem permissão para alterar esta cotação' });
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
  console.error(err);
  res.status(500).json({ message: 'Erro interno no servidor' });
});

app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
