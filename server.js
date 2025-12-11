require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fetchFn = global.fetch || require('node-fetch');
const PDFDocument = require('pdfkit');
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

const INVOICE_DEFAULTS = {
  companyName: 'ZENITH PAY',
  addressLine1: 'C. N PAGAMENTOS ONLINE LTDA',
  addressLine2: 'R. WASHINGTON LUIS, 59, LOTE 10B, QUADRA 43, CXPST 20 - CENTRO, NOSSA SENHORA DAS GRÇAS – PR – CEP: 86.680-000 – BRASIL',
  phone: 'Tel: [Telefone]',
  fax: 'Fax: [Fax]',
  email: 'Email: [Email]',
  website: 'Web: www.zenithpay.com',
  taxId: 'CNPJ/Tax ID: 53.213.723/0001-35',
  romalpaClause:
    process.env.INVOICE_ROMALPA_CLAUSE
    || 'Goods sold and delivered remain the property of Zenith Pay until full payment is received.',
  terms: (process.env.INVOICE_TERMS || 'Goods sold are not returnable unless defective.|Payment must be received before shipment for prepayment terms.|Any disputes shall be governed by the laws of [Jurisdiction].|Buyer is responsible for all import duties, taxes, and customs clearance fees.').split('|')
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

const sanitizeText = (value, fallback = '') => {
  if (value === undefined || value === null) return fallback;
  return value.toString().trim();
};

const truncateText = (text, maxLength, suffix = '...') => {
  if (!text) return '';
  const str = text.toString().trim();
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - suffix.length) + suffix;
};

const buildClienteDataFromInvoice = (body = {}) => {
  const base = {
    nome: sanitizeText(body.nome || body.customerName, ''),
    documento: sanitizeText(body.documento || body.customerTaxId, ''),
    email: sanitizeText(body.email || body.customerEmail, ''),
    telefone: sanitizeText(body.telefone || body.customerPhone, ''),
    endereco: sanitizeText(body.endereco || body.customerAddressLine1, ''),
    contato: sanitizeText(body.contato || body.customerContact, '')
  };
  return {
    ...base,
    invoicePaymentTerms: sanitizeText(body.invoicePaymentTerms || body.paymentTerms),
    invoiceDeliveryTerms: sanitizeText(body.invoiceDeliveryTerms || body.deliveryTerms),
    countryOfOrigin: sanitizeText(body.countryOfOrigin),
    hsCode: sanitizeText(body.hsCode),
    deliveryInfo: sanitizeText(body.deliveryInfo),
    shippingMethod: sanitizeText(body.shippingMethod),
    bankName: sanitizeText(body.bankName),
    bankSwift: sanitizeText(body.bankSwift || body.swiftCode),
    bankBranch: sanitizeText(body.bankBranch),
    bankAccount: sanitizeText(body.bankAccount || body.beneficiaryAccount || body.iban),
    bankBeneficiary: sanitizeText(body.bankBeneficiary || body.beneficiaryName),
    bankBeneficiaryAddress: sanitizeText(body.bankBeneficiaryAddress || body.beneficiaryAddress),
    intermediaryBank: sanitizeText(body.intermediaryBank),
    intermediarySwift: sanitizeText(body.intermediarySwift)
  };
};

const parseAmount = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const ensureArray = value => (Array.isArray(value) ? value : []);

const numberToWordsUSD = (value) => {
  const num = Math.floor(Number(value) || 0);
  if (num === 0) return 'ZERO DÓLARES AMERICANOS';

  const units = ['', 'UM', 'DOIS', 'TRÊS', 'QUATRO', 'CINCO', 'SEIS', 'SETE', 'OITO', 'NOVE'];
  const teens = ['DEZ', 'ONZE', 'DOZE', 'TREZE', 'QUATORZE', 'QUINZE', 'DEZESSEIS', 'DEZESSETE', 'DEZOITO', 'DEZENOVE'];
  const tens = ['', '', 'VINTE', 'TRINTA', 'QUARENTA', 'CINQUENTA', 'SESSENTA', 'SETENTA', 'OITENTA', 'NOVENTA'];
  const hundreds = ['', 'CENTO', 'DUZENTOS', 'TREZENTOS', 'QUATROCENTOS', 'QUINHENTOS', 'SEISCENTOS', 'SETECENTOS', 'OITOCENTOS', 'NOVECENTOS'];

  const convertGroup = (n) => {
    if (n === 0) return '';
    if (n === 100) return 'CEM';
    let result = '';
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const u = n % 10;
    if (h > 0) result += hundreds[h];
    if (h > 0 && (t > 0 || u > 0)) result += ' E ';
    if (t === 1) {
      result += teens[u];
    } else {
      if (t > 0) result += tens[t];
      if (t > 0 && u > 0) result += ' E ';
      if (u > 0) result += units[u];
    }
    return result;
  };

  const millions = Math.floor(num / 1000000);
  const thousands = Math.floor((num % 1000000) / 1000);
  const remainder = num % 1000;
  let result = '';

  if (millions > 0) {
    result += convertGroup(millions);
    result += millions === 1 ? ' MILHÃO' : ' MILHÕES';
  }
  if (thousands > 0) {
    if (result) result += ', ';
    result += convertGroup(thousands);
    result += ' MIL';
  }
  if (remainder > 0) {
    if (result) result += (thousands === 0 && millions > 0) ? ' E ' : ', ';
    result += convertGroup(remainder);
  }

  result += ' DÓLARES AMERICANOS';
  const cents = Math.round((value - num) * 100);
  if (cents > 0) {
    result += ' E ' + convertGroup(cents) + (cents === 1 ? ' CENTAVO' : ' CENTAVOS');
  }
  return result + ' APENAS';
};

const buildInvoicePayload = payload => {
  const invoiceDate = sanitizeText(payload.invoiceDate, new Date().toISOString().slice(0, 10));
  const invoiceNumber = sanitizeText(payload.invoiceNumber, `INV-${invoiceDate.replace(/-/g, '')}`);
  const customer = {
    name: truncateText(sanitizeText(payload.customerName), 60),
    addressLine1: truncateText(sanitizeText(payload.customerAddressLine1), 80),
    addressLine2: truncateText(sanitizeText(payload.customerAddressLine2), 80),
    cityState: truncateText(sanitizeText(payload.customerCityState), 60),
    country: truncateText(sanitizeText(payload.customerCountry), 40),
    taxId: truncateText(sanitizeText(payload.customerTaxId), 30),
    email: truncateText(sanitizeText(payload.customerEmail), 50),
    phone: truncateText(sanitizeText(payload.customerPhone), 30)
  };

  const items = ensureArray(payload.items).map((item, index) => {
    const tipo = sanitizeText(item.tipo || 'product');
    const qtyRaw = parseAmount(item.quantity);
    const qty = tipo === 'service' ? (qtyRaw > 0 ? qtyRaw : 1) : qtyRaw;
    const unitPrice = parseAmount(item.unitPrice);
    const total = qty * unitPrice;
    return {
      serial: index + 1,
      tipo,
      serviceDate: sanitizeText(item.serviceDate),
      reference: truncateText(sanitizeText(item.reference), 20),
      partNumber: truncateText(sanitizeText(item.partNumber), 25),
      description: truncateText(sanitizeText(item.description), 200),
      quantity: qty,
      unit: truncateText(sanitizeText(item.unit || 'PCS'), 10),
      unitPrice,
      total
    };
  });

  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const discount = parseAmount(payload.discount);
  const shipping = parseAmount(payload.shipping);
  const total = subtotal - discount + shipping;
  const toCurrency = value => `USD $ ${value.toFixed(2)}`;

  return {
    company: {
      ...INVOICE_DEFAULTS,
      name: INVOICE_DEFAULTS.companyName,
      addressLine1: INVOICE_DEFAULTS.addressLine1,
      addressLine2: INVOICE_DEFAULTS.addressLine2,
      phone: INVOICE_DEFAULTS.phone,
      fax: INVOICE_DEFAULTS.fax,
      email: INVOICE_DEFAULTS.email,
      website: INVOICE_DEFAULTS.website,
      taxId: INVOICE_DEFAULTS.taxId
    },
    customer,
    invoice: {
      number: truncateText(invoiceNumber, 30),
      date: invoiceDate,
      customerNumber: truncateText(sanitizeText(payload.customerNumber), 25),
      paymentTerms: truncateText(sanitizeText(payload.paymentTerms, 'Prepayment'), 30),
      deliveryTerms: truncateText(sanitizeText(payload.deliveryTerms, 'FOB'), 20)
    },
    logistic: {
      countryOfOrigin: sanitizeText(payload.countryOfOrigin),
      hsCode: sanitizeText(payload.hsCode),
      deliveryInfo: sanitizeText(payload.deliveryInfo),
      shippingMethod: sanitizeText(payload.shippingMethod)
    },
    payment: {
      bankName: sanitizeText(payload.bankName),
      swiftCode: sanitizeText(payload.swiftCode),
      bankBranch: sanitizeText(payload.bankBranch),
      beneficiaryAccount: sanitizeText(payload.beneficiaryAccount),
      iban: sanitizeText(payload.iban),
      beneficiaryName: sanitizeText(payload.beneficiaryName, INVOICE_DEFAULTS.companyName),
      beneficiaryAddress: sanitizeText(payload.beneficiaryAddress),
      intermediaryBank: sanitizeText(payload.intermediaryBank),
      intermediarySwift: sanitizeText(payload.intermediarySwift)
    },
    acknowledgement: sanitizeText(payload.acknowledgementText, 'Received above goods in good order & condition. Goods sold are not returnable.'),
    signatureName: sanitizeText(payload.signatureName, 'Zenith Pay'),
    notes: ensureArray(payload.extraNotes).map(line => sanitizeText(line)).filter(Boolean),
    items,
    totals: {
      subtotal,
      discount,
      shipping,
      total,
      formatted: {
        subtotal: toCurrency(subtotal),
        discount: toCurrency(discount),
        shipping: toCurrency(shipping),
        total: toCurrency(total)
      },
      amountInWords: numberToWordsUSD(total)
    }
  };
};

const renderInvoicePdf = (res, invoice) => {
  const doc = new PDFDocument({ size: 'A4', margin: 30 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoice.number}.pdf"`);
  doc.pipe(res);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.page.margins.left;

  const formatMoney = value => {
    const num = Number(value) || 0;
    const parts = num.toFixed(2).split('.');
    const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `USD $ ${intPart},${parts[1]}`;
  };
  const toUpperSafe = value => (value || '').toString().toUpperCase();
  const line = (x1, y1, x2, y2, width = 1, color = '#000') => {
    doc.save();
    doc.lineWidth(width).strokeColor(color).moveTo(x1, y1).lineTo(x2, y2).stroke();
    doc.restore();
  };

  // Header
  doc.font('Helvetica-Bold').fontSize(22).text(invoice.company.name || 'ZENITH PAY', startX, doc.y, { align: 'center', width: pageWidth });
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(8).fillColor('#333');
  [
    invoice.company.addressLine1 || '',
    invoice.company.addressLine2 || '',
    `${invoice.company.phone} | ${invoice.company.email || ''}`,
    `${invoice.company.website} | ${invoice.company.taxId}`
  ].forEach(text => {
    if (text.trim()) {
      doc.text(text, { align: 'center', width: pageWidth, lineGap: 1 });
    }
  });
  line(startX, doc.y + 8, startX + pageWidth, doc.y + 8, 3, '#D4AF37');
  doc.y += 20;

  // Info container
  const infoTop = doc.y;
  const gap = 20;
  const leftWidth = (pageWidth - gap) * 0.52;
  const rightWidth = pageWidth - gap - leftWidth;

  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text('DESTINATÁRIO', startX, infoTop, { width: leftWidth });
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(10);
  const recipientLines = [
    invoice.customer.name || '-',
    invoice.customer.addressLine1 || '',
    invoice.customer.addressLine2 || '',
    invoice.customer.cityState || '',
    invoice.customer.country || '',
    `CNPJ / Tax ID: ${invoice.customer.taxId || '-'}`,
    `Email: ${invoice.customer.email || '-'}`,
    `Telefone: ${invoice.customer.phone || '-'}`,
    invoice.customer.contact ? `Contato: ${invoice.customer.contact}` : ''
  ].filter(Boolean);
  recipientLines.forEach(text => doc.text(text, { width: leftWidth, lineGap: 2 }));
  const leftBottom = doc.y;

  // Details box
  const boxX = startX + leftWidth + gap;
  const boxPad = 12;
  const boxTop = infoTop;
  const boxWidth = rightWidth;

  // Preparar dados com simplificações
  const invoiceNum = truncateText(invoice.invoice.number || '-', 20);
  const invoiceDate = invoice.invoice.date || '-';

  // Simplificar Cliente Nº - pegar apenas primeiros 8 chars se for UUID
  let customerNum = invoice.invoice.customerNumber || '-';
  if (customerNum.length > 20 && customerNum.includes('-')) {
    customerNum = customerNum.split('-')[0];
  }

  const paymentTerms = truncateText(invoice.invoice.paymentTerms || 'Prepayment', 25);
  const deliveryTerms = truncateText(invoice.invoice.deliveryTerms || 'FOB', 15);

  // Calcular altura - 3 linhas fixas
  const lineH = 18;
  const numLines = 3;
  const boxHeight = boxPad * 2 + numLines * lineH;

  // Desenhar box
  doc.rect(boxX, boxTop, boxWidth, boxHeight).lineWidth(2).stroke();

  // Layout de 2 colunas
  const col1X = boxX + boxPad;
  const col2X = boxX + (boxWidth / 2);
  const colW = (boxWidth / 2) - boxPad * 1.5;

  let rowY = boxTop + boxPad;

  // Linha 1: Fatura Nº | Data
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Fatura Nº:', col1X, rowY, { width: colW, continued: true });
  doc.font('Helvetica').text(' ' + invoiceNum, { width: colW });

  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Data:', col2X, rowY, { width: colW, continued: true });
  doc.font('Helvetica').text(' ' + invoiceDate, { width: colW });

  rowY += lineH;

  // Linha 2: Cliente Nº | Pagamento
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Cliente Nº:', col1X, rowY, { width: colW, continued: true });
  doc.font('Helvetica').text(' ' + customerNum, { width: colW });

  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Pagamento:', col2X, rowY, { width: colW, continued: true });
  doc.font('Helvetica').text(' ' + paymentTerms, { width: colW });

  rowY += lineH;

  // Linha 3: Entrega (ocupa toda linha)
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Entrega:', col1X, rowY, { width: colW, continued: true });
  doc.font('Helvetica').text(' ' + deliveryTerms, { width: boxWidth - boxPad * 2 });

  doc.y = Math.max(leftBottom, boxTop + boxHeight) + 18;

  // Items table
  const items = invoice.items || [];
  if (items.length) {
    const tableTop = doc.y;
    const colWidths = [40, 90, pageWidth - (40 + 90 + 70 + 100 + 100), 70, 100, 100];
    const colX = [];
    colWidths.reduce((acc, w, i) => { colX[i] = acc; return acc + w; }, startX);
    const headerHeight = 24;
    doc.rect(startX, tableTop, pageWidth, headerHeight).fillAndStroke('#f5f5f5', '#000');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
    ['Item', 'Cód. Produto', 'Descrição', 'Quantidade', 'Preço Unitário (USD)', 'Valor Total (USD)'].forEach((text, idx) => {
      doc.text(text, colX[idx] + 6, tableTop + 8, { width: colWidths[idx] - 12, align: idx === 0 ? 'center' : idx >= 4 ? 'right' : 'left' });
    });
    let rowY = tableTop + headerHeight;
    doc.font('Helvetica').fontSize(10).fillColor('#000');
    items.forEach(item => {
      const desc = item.description || '-';
      const descHeight = doc.heightOfString(desc, { width: colWidths[2] - 12, lineGap: 2, align: 'left' });
      const rowHeight = Math.max(28, descHeight + 10);
      doc.rect(startX, rowY, pageWidth, rowHeight).stroke();
      for (let i = 1; i < colWidths.length; i++) line(colX[i], rowY, colX[i], rowY + rowHeight);
      doc.text(String(item.serial), colX[0], rowY + 8, { width: colWidths[0], align: 'center' });
      doc.text(item.partNumber || '-', colX[1] + 6, rowY + 8, { width: colWidths[1] - 12 });
      doc.text(desc, colX[2] + 6, rowY + 6, { width: colWidths[2] - 12, lineGap: 2 });
      doc.text(`${item.quantity} ${item.unit || ''}`.trim(), colX[3], rowY + 8, { width: colWidths[3], align: 'center' });
      doc.text(formatMoney(item.unitPrice), colX[4], rowY + 8, { width: colWidths[4] - 12, align: 'right' });
      doc.text(formatMoney(item.total), colX[5], rowY + 8, { width: colWidths[5] - 12, align: 'right' });
      rowY += rowHeight;
    });
    doc.y = rowY + 20;
  }

  // Totals
  const totalsLabelW = 150;
  const totalsValueW = 150;
  const totalsStartX = startX + pageWidth - (totalsLabelW + totalsValueW);
  doc.font('Helvetica').fontSize(10);
  [['Subtotal', invoice.totals.subtotal], ['Desconto', invoice.totals.discount], ['Frete', invoice.totals.shipping]].forEach(([label, val]) => {
    doc.text(label, totalsStartX, doc.y, { width: totalsLabelW, align: 'right' });
    doc.font('Helvetica-Bold').text(formatMoney(val), totalsStartX + totalsLabelW, doc.y, { width: totalsValueW, align: 'right' });
    doc.moveDown(0.3);
    doc.font('Helvetica');
  });
  doc.font('Helvetica-Bold').fontSize(12);
  const grandStartY = doc.y + 3;
  line(totalsStartX, grandStartY, startX + pageWidth, grandStartY, 2);
  doc.text('TOTAL:', totalsStartX, grandStartY + 5, { width: totalsLabelW, align: 'right' });
  doc.text(formatMoney(invoice.totals.total), totalsStartX + totalsLabelW, grandStartY + 5, { width: totalsValueW, align: 'right' });
  line(totalsStartX, grandStartY + 22, startX + pageWidth, grandStartY + 22, 3);
  doc.y = grandStartY + 30;
  doc.font('Helvetica-Oblique').fontSize(9).text(`(DIGA-SE ${invoice.totals?.amountInWords || 'VALOR NÃO ESPECIFICADO'})`, startX, doc.y, { width: pageWidth, align: 'right' });
  doc.moveDown(1);

  // Additional info
  doc.font('Helvetica-Bold').fontSize(9).text('PAÍS DE ORIGEM:', startX, doc.y, { width: pageWidth });
  doc.font('Helvetica').fontSize(9).text(invoice.logistic.countryOfOrigin || '-', { width: pageWidth, lineGap: 1 });
  doc.moveDown(0.4);

  doc.font('Helvetica-Bold').text('CÓDIGO HS:', startX, doc.y, { width: pageWidth });
  doc.font('Helvetica').text(invoice.logistic.hsCode || '-', { width: pageWidth, lineGap: 1 });
  doc.moveDown(0.4);

  doc.font('Helvetica-Bold').text('INFORMAÇÕES DE ENTREGA:', startX, doc.y, { width: pageWidth });
  doc.font('Helvetica').text(invoice.logistic.deliveryInfo || '-', { width: pageWidth, lineGap: 1 });
  if (invoice.logistic.shippingMethod) {
    doc.text(`Método de Envio: ${invoice.logistic.shippingMethod}`, { width: pageWidth, lineGap: 1 });
  }
  doc.moveDown(0.6);

  // Bank details
  const bankTop = doc.y;
  const bankPadding = 12;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('INSTRUÇÕES DE PAGAMENTO:', startX + bankPadding, bankTop + bankPadding);
  doc.font('Helvetica').fontSize(8);
  const bankFields = [
    ['Nome do Banco', invoice.payment.bankName],
    ['Código Swift', invoice.payment.swiftCode],
    ['Agência', invoice.payment.bankBranch],
    ['Conta Beneficiário', invoice.payment.beneficiaryAccount],
    ['IBAN', invoice.payment.iban],
    ['Nome do Beneficiário', invoice.payment.beneficiaryName],
    ['Endereço do Beneficiário', invoice.payment.beneficiaryAddress],
    ['Banco Intermediário', invoice.payment.intermediaryBank],
    ['Código Swift Intermediário', invoice.payment.intermediarySwift]
  ].filter(([, v]) => v);
  let bankCursor = bankTop + bankPadding + 16;
  bankFields.forEach(([label, val]) => {
    doc.font('Helvetica-Bold').text(`${label}: `, startX + bankPadding, bankCursor, { continued: true });
    doc.font('Helvetica').text(val);
    bankCursor = doc.y;
  });
  const bankHeight = Math.max(85, bankCursor - bankTop + bankPadding);
  doc.rect(startX, bankTop, pageWidth, bankHeight).fillAndStroke('#f9f9f9', '#ddd');
  doc.strokeColor('#000');
  doc.y = bankTop + bankHeight + 12;

  // Legal text
  doc.font('Helvetica-Bold').fontSize(8).text('CLÁUSULA ROMALPA:');
  doc.font('Helvetica').fontSize(8).fillColor('#333').text(INVOICE_DEFAULTS.romalpaClause, { lineGap: 1 });
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fillColor('#000').text('DECLARAÇÕES LEGAIS:');
  doc.font('Helvetica').fillColor('#333').text(invoice.acknowledgement || 'Mercadorias recebidas em boas condições. Mercadorias vendidas não são retornáveis.', { lineGap: 1 });
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fillColor('#000').text('TERMOS E CONDIÇÕES:');
  INVOICE_DEFAULTS.terms.forEach(term => {
    doc.font('Helvetica').fillColor('#333').text(`• ${term}`, { lineGap: 1 });
  });
  doc.fillColor('#000');

  // Footer signatures
  doc.fillColor('#000');
  doc.moveDown(1.5);
  line(startX, doc.y, startX + pageWidth, doc.y, 2);
  doc.moveDown(1.2);

  const sigTop = doc.y;
  const sigWidth = 230;
  const sigGap = pageWidth - sigWidth * 2;
  const leftSigX = startX + (sigGap / 4);
  const rightSigX = leftSigX + sigWidth + (sigGap / 2);

  // Assinatura esquerda
  doc.font('Helvetica').fontSize(8);
  doc.text('Mercadorias recebidas em boas condições', leftSigX, sigTop, {
    width: sigWidth,
    align: 'center'
  });
  doc.text('Mercadorias vendidas não são retornáveis', leftSigX, doc.y, {
    width: sigWidth,
    align: 'center'
  });

  // Assinatura direita
  const rightTopY = sigTop;
  doc.text('Em Nome de', rightSigX, rightTopY, {
    width: sigWidth,
    align: 'center'
  });
  doc.font('Helvetica-Bold');
  doc.text('Zenith Pay', rightSigX, doc.y, {
    width: sigWidth,
    align: 'center'
  });

  // Linhas de assinatura
  const sigLineY = sigTop + 45;
  line(leftSigX + 20, sigLineY, leftSigX + sigWidth - 20, sigLineY, 1);
  line(rightSigX + 20, sigLineY, rightSigX + sigWidth - 20, sigLineY, 1);

  doc.font('Helvetica').fontSize(7);
  doc.text('Carimbo e Assinatura', leftSigX, sigLineY + 5, {
    width: sigWidth,
    align: 'center'
  });
  doc.text('Assinatura Autorizada', rightSigX, sigLineY + 5, {
    width: sigWidth,
    align: 'center'
  });

  doc.y = sigLineY + 25;

  doc.moveDown(0.8);
  doc.font('Helvetica-Oblique').fontSize(7).fillColor('#666');
  doc.text(
    'Esta é uma fatura gerada por computador. Nenhuma assinatura necessária.',
    startX,
    doc.y,
    { align: 'center', width: pageWidth }
  );

  doc.end();
};

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

app.post('/invoices/generate', authenticate, adminOnly, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];

  if (items.length === 0) {
    return res.status(400).json({ message: 'Inclua ao menos um item na invoice.' });
  }

  const clientePayload = buildClienteDataFromInvoice({
    ...body,
    customerName: body.customerName,
    customerTaxId: body.customerTaxId,
    customerPhone: body.customerPhone,
    customerEmail: body.customerEmail,
    customerAddressLine1: body.customerAddressLine1
  });

  if (!clientePayload.nome || !clientePayload.documento) {
    return res.status(400).json({ message: 'Informe nome e documento do cliente para gerar a invoice.' });
  }

  let cliente;
  if (body.clienteId) {
    cliente = await prisma.cliente.findUnique({ where: { id: body.clienteId } });
    if (!cliente) {
      return res.status(404).json({ message: 'Cliente não encontrado.' });
    }
    cliente = await prisma.cliente.update({
      where: { id: body.clienteId },
      data: clientePayload
    });
  } else {
    cliente = await prisma.cliente.create({ data: clientePayload });
  }

  const clienteData = {
    customerName: cliente.nome,
    customerAddressLine1: cliente.endereco || '',
    customerPhone: cliente.telefone || '',
    customerEmail: cliente.email || '',
    customerTaxId: cliente.documento || ''
  };

  const payload = buildInvoicePayload({
    ...clienteData,
    ...body,
    items
  });

  return renderInvoicePdf(res, payload);
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
  const {
    nome,
    documento,
    email,
    telefone,
    endereco,
    observacoes,
    contato,
    invoicePaymentTerms,
    invoiceDeliveryTerms,
    countryOfOrigin,
    hsCode,
    deliveryInfo,
    shippingMethod,
    bankName,
    bankSwift,
    bankBranch,
    bankAccount,
    bankBeneficiary,
    bankBeneficiaryAddress,
    intermediaryBank,
    intermediarySwift
  } = req.body;
  const cliente = await prisma.cliente.create({
    data: {
      nome,
      documento,
      email,
      telefone,
      endereco,
      observacoes,
      contato,
      invoicePaymentTerms,
      invoiceDeliveryTerms,
      countryOfOrigin,
      hsCode,
      deliveryInfo,
      shippingMethod,
      bankName,
      bankSwift,
      bankBranch,
      bankAccount,
      bankBeneficiary,
      bankBeneficiaryAddress,
      intermediaryBank,
      intermediarySwift
    }
  });
  res.status(201).json(cliente);
}));

app.put('/clientes/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    nome,
    documento,
    email,
    telefone,
    endereco,
    observacoes,
    contato,
    invoicePaymentTerms,
    invoiceDeliveryTerms,
    countryOfOrigin,
    hsCode,
    deliveryInfo,
    shippingMethod,
    bankName,
    bankSwift,
    bankBranch,
    bankAccount,
    bankBeneficiary,
    bankBeneficiaryAddress,
    intermediaryBank,
    intermediarySwift
  } = req.body;
  const cliente = await prisma.cliente.update({
    where: { id },
    data: {
      nome,
      documento,
      email,
      telefone,
      endereco,
      observacoes,
      contato,
      invoicePaymentTerms,
      invoiceDeliveryTerms,
      countryOfOrigin,
      hsCode,
      deliveryInfo,
      shippingMethod,
      bankName,
      bankSwift,
      bankBranch,
      bankAccount,
      bankBeneficiary,
      bankBeneficiaryAddress,
      intermediaryBank,
      intermediarySwift
    }
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
