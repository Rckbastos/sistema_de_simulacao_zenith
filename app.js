(() => {
  const STORAGE_OK = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  const TOKEN_KEY = 'zenith-auth-token';
  const USER_KEY = 'zenith-auth-user';

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

  const PERMISSOES_LABELS = {
    dashboard: 'Dashboard',
    novaCotacao: 'Nova Cotação',
    cotacoesAbertas: 'Cotações em Aberto',
    cotacoesFechadas: 'Cotações Fechadas',
    clientes: 'Clientes',
    comerciais: 'Gerenciar Comerciais',
    adminServicos: 'Admin - Serviços',
    adminMaster: 'Administrador (todos os acessos)'
  };

  const TAB_PERMISSION_MAP = {
    dashboard: 'dashboard',
    'nova-cotacao': 'novaCotacao',
    'cotacoes-abertas': 'cotacoesAbertas',
    'cotacoes-fechadas': 'cotacoesFechadas',
    clientes: 'clientes',
    comerciais: 'comerciais',
    admin: 'adminServicos',
    kyc: 'adminMaster',
    invoice: 'adminMaster',
    'invoice-historico': 'adminMaster'
  };

  const currencyFormatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
  const currencyFormatterUSD = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  });
  const MAX_COTACAO_ITENS = 3;
  const MAX_INVOICE_ITENS = 3;

  const safeParse = (value, fallback = null) => {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  };

  const state = {
    token: STORAGE_OK ? window.localStorage.getItem(TOKEN_KEY) : null,
    user: STORAGE_OK ? safeParse(window.localStorage.getItem(USER_KEY), null) : null,
    servicos: [],
    clientes: [],
    comerciais: [],
    cotacoes: [],
    ticker: null,
    tickerUpdatedAt: null,
    servicoEditando: null,
    clienteEditando: null,
    comercialEditando: null,
    kycRegistros: [],
    cotacaoItens: [],
    cotacaoMoeda: 'BRL',
    cotacaoUsdtBrl: null,
    invoiceItens: [],
    invoiceForm: null
  };

  const el = id => document.getElementById(id);
  const setValue = (id, value = '') => {
    const node = el(id);
    if (node) node.value = value;
  };
  const setText = (id, value = '') => {
    const node = el(id);
    if (node) node.textContent = value;
  };
  const formatCurrency = value => currencyFormatter.format(Number(value) || 0);
  const formatCurrencyByMoeda = (value, moeda = 'BRL') => {
    const numero = Number(value) || 0;
    const m = (moeda || 'BRL').toString().trim().toUpperCase();
    if (m === 'USD' || m === 'USDT') {
      return `${m} ${currencyFormatterUSD.format(numero).replace('$', '').trim()}`;
    }
    return currencyFormatter.format(numero);
  };
  const normalizarMoedaLocal = (moeda = 'BRL') => {
    const normalized = (moeda || 'BRL').toString().trim().toUpperCase();
    return normalized || 'BRL';
  };
  const adicionarValorPorMoeda = (mapa, moeda, valor) => {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return;
    const chave = normalizarMoedaLocal(moeda);
    mapa[chave] = (mapa[chave] || 0) + numero;
  };
  const mesclarMapaMoedas = (destino, origem = {}) => {
    Object.entries(origem || {}).forEach(([moeda, valor]) => {
      adicionarValorPorMoeda(destino, moeda, valor);
    });
  };
  const formatMapaMoedas = mapa => {
    const partes = Object.entries(mapa)
      .filter(([, valor]) => Math.abs(valor) > 0.0001);
    if (!partes.length) return formatCurrency(0);
    return partes
      .map(([moeda, valor]) => formatCurrencyByMoeda(valor, moeda))
      .join(' + ');
  };
  const calcularMapaCotacaoPorCampo = (cotacao, campo = 'valorVenda') => {
    const mapa = {};
    const itens = extrairItensCotacao(cotacao);
    itens.forEach(item => {
      const valor = Number(item[campo]) || 0;
      if (!valor) return;
      adicionarValorPorMoeda(mapa, item.moeda || cotacao?.moeda || 'BRL', valor);
    });
    return mapa;
  };
  const formatarTotalCotacaoPorCampo = (cotacao, campo = 'valorVenda') => {
    const mapa = calcularMapaCotacaoPorCampo(cotacao, campo);
    return formatMapaMoedas(mapa);
  };
  const extrairItensCotacao = cotacao => {
    if (Array.isArray(cotacao?.itens) && cotacao.itens.length > 0) {
      return cotacao.itens.map(item => ({
        ...item,
        servicoNome: item.servicoNome || item.servico?.nome || 'Serviço',
        moeda: normalizarMoedaLocal(item.moeda || cotacao.moeda || 'BRL'),
        valorVenda: Number(item.valorVenda) || 0,
        comissao: Number(item.comissao) || 0
      }));
    }
    if (!cotacao) return [];
    if (!cotacao.servicoNome && !cotacao.valorVenda) return [];
    return [{
      servicoNome: cotacao.servicoNome || 'Serviço',
      valorVenda: Number(cotacao.valorVenda) || 0,
      comissao: Number(cotacao.comissao) || 0,
      moeda: normalizarMoedaLocal(cotacao.moeda || 'BRL')
    }];
  };
  const formatarServicosCotacaoHtml = cotacao => {
    const itens = extrairItensCotacao(cotacao);
    if (!itens.length) return '-';
    return itens.map(item => `
      <div class="cotacao-servico">
        <span>${escapeHtml(item.servicoNome)}</span>
        <strong>${formatCurrencyByMoeda(item.valorVenda, item.moeda)}</strong>
      </div>
    `).join('');
  };
  const formatarServicosCotacaoTexto = cotacao => {
    const itens = extrairItensCotacao(cotacao);
    if (!itens.length) return '-';
    return itens
      .map(item => `${item.servicoNome} (${formatCurrencyByMoeda(item.valorVenda, item.moeda)})`)
      .join(', ');
  };
  const formatDate = value => {
    if (!value) return '-';
    try {
      return new Date(value).toLocaleDateString('pt-BR');
    } catch (error) {
      return value;
    }
  };
  const escapeHtml = value => (value || '').toString().replace(/[&<>"']/g, match => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[match]);
  const formatInvoiceIssueDate = value => {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) {
      const now = new Date();
      return now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const jsStringLiteral = value => `'${String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')}'`;

  const tickerFormatter = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
  });
  const TICKER_REFRESH_MS = 3000;
  const USDT_SPREAD_PCT = 0.003; // 0.30% spread
  let tickerTimer = null;
  let tickerStatusTimer = null;
  let cotacaoItemSeq = 0;
  const gerarItemId = () => `item-${Date.now()}-${cotacaoItemSeq++}`;
  const novoItemCotacao = (overrides = {}) => ({
    uid: gerarItemId(),
    servicoId: '',
    valorVenda: '',
    ...overrides
  });
  const resetarCotacaoItens = () => {
    state.cotacaoItens = [novoItemCotacao()];
  };
  if (state.cotacaoItens.length === 0) {
    resetarCotacaoItens();
  }

  let invoiceItemSeq = 0;
  const gerarInvoiceItemId = () => `inv-item-${Date.now()}-${invoiceItemSeq++}`;
  const novoInvoiceItem = (overrides = {}) => ({
    uid: gerarInvoiceItemId(),
    tipo: 'service',
    partNumber: '',
    description: '',
    quantity: '',
    unit: '',
    unitPrice: '',
    serviceDate: '',
    reference: '',
    ...overrides
  });
  const getDefaultInvoiceForm = () => {
    const hoje = new Date();
    const dataIso = hoje.toISOString().slice(0, 10);
    return {
      language: 'pt',
      clienteId: '',
      clienteNome: '',
      clienteTaxId: '',
      clienteContato: '',
      clienteEmail: '',
      clienteTelefone: '',
      clienteEndereco: '',
      customerNumber: '',
      invoiceNumber: '',
      invoiceDate: dataIso,
      moeda: 'USD',
      paymentTerms: 'Prepayment',
      deliveryTerms: 'FOB',
      countryOfOrigin: 'Brazil',
      hsCode: '',
      deliveryInfo: '',
      shippingMethod: 'Standard',
      desconto: 0,
      observacoes: '',
      bankName: '',
      bankSwift: '',
      bankBranch: '',
      bankAccount: '',
      bankBeneficiary: 'ZENITH PAY',
      bankBeneficiaryAddress: '',
      intermediaryBank: '',
      intermediarySwift: ''
    };
  };
  const resetarInvoice = () => {
    state.invoiceForm = getDefaultInvoiceForm();
    state.invoiceItens = [novoInvoiceItem()];
    state.invoiceHistorico = [];
  };
  const prepararEstadoInvoice = () => {
    if (!state.invoiceForm || !Array.isArray(state.invoiceItens) || state.invoiceItens.length === 0) {
      resetarInvoice();
    }
  };
  prepararEstadoInvoice();
  const temCotacaoMultiUI = () => Boolean(el('cotacaoItensContainer'));
  const temInvoiceUI = () => Boolean(el('invoiceItensContainer'));

  const formatTickerValue = value => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '--';
    return tickerFormatter.format(num);
  };

  const renderTicker = data => {
    const track = el('tickerTrack');
    if (!track) return;

    const pairs = [
      { label: 'USD/BRL', value: data?.usdBrl },
      { label: 'USD/USDT', value: data?.usdUsdt },
      { label: 'USDT/BRL', value: data?.usdtBrl }
    ];

    const content = pairs
      .map(item => `<span class="ticker-item"><strong>${item.label}</strong><span class="ticker-value">${formatTickerValue(item.value)}</span></span>`)
      .join('<span class="ticker-item">|</span>');

    track.innerHTML = content ? `${content}${content}` : '<span class="ticker-item">Cotações indisponíveis</span>';
  };

  const atualizarBarraTicker = () => {
    const bar = el('tickerRefreshBar');
    const label = el('tickerRefreshLabel');
    if (!bar || !label) return;
    const interval = TICKER_REFRESH_MS;
    const last = state.tickerUpdatedAt
      || (state.ticker?.updatedAt ? Date.parse(state.ticker.updatedAt) : null);
    if (!last || Number.isNaN(last)) {
      bar.style.width = '0%';
      label.textContent = 'Aguardando cotação...';
      return;
    }
    const now = Date.now();
    const elapsed = now - last;
    const remaining = Math.max(0, interval - (elapsed % interval));
    const percent = Math.max(0, Math.min(100, (remaining / interval) * 100));
    bar.style.width = `${percent}%`;
    label.textContent = `Atualiza em ${(remaining / 1000).toFixed(1)}s`;
  };

  const scheduleTickerRefresh = () => {
    if (tickerTimer) {
      window.clearTimeout(tickerTimer);
    }
    tickerTimer = window.setTimeout(fetchTicker, TICKER_REFRESH_MS);
  };

  const fetchTicker = async () => {
    try {
      const response = await fetch('/cotacoes/ticker');
      if (!response.ok) {
        throw new Error('Não foi possível consultar as cotações.');
      }
      const data = await response.json();
      state.ticker = data;
      state.tickerUpdatedAt = Date.now();
      renderTicker(data);
      if (temCotacaoMultiUI() || el('cotacaoServico')) {
        calcularCotacao();
      } else {
        atualizarResumoCambio(false);
      }
      atualizarBarraTicker();
    } catch (error) {
      console.warn('Ticker indisponível', error);
    } finally {
      scheduleTickerRefresh();
    }
  };

  const iniciarAtualizacaoTicker = () => {
    if (tickerTimer) {
      window.clearTimeout(tickerTimer);
    }
    if (tickerStatusTimer) {
      window.clearInterval(tickerStatusTimer);
    }
    tickerStatusTimer = window.setInterval(atualizarBarraTicker, 200);
    fetchTicker();
  };

  const pararAtualizacaoTicker = () => {
    if (tickerTimer) {
      window.clearTimeout(tickerTimer);
      tickerTimer = null;
    }
  };

  const getDefaultPermissoes = () => ({ ...DEFAULT_PERMISSIONS });
  const normalizePermissoes = (permissoes = {}) => {
    const normalized = { ...DEFAULT_PERMISSIONS };
    Object.keys(normalized).forEach(key => {
      if (Object.prototype.hasOwnProperty.call(permissoes, key)) {
        normalized[key] = Boolean(permissoes[key]);
      }
    });
    if (normalized.adminMaster) {
      Object.keys(normalized).forEach(key => (normalized[key] = true));
      normalized.adminMaster = true;
    }
    return normalized;
  };

  const isAdminUser = () => state.user?.tipo === 'admin' || state.user?.permissoes?.adminMaster;
  const getComercialIdAtual = () => (state.user?.tipo === 'comercial' ? state.user.id : null);

  const saveSession = (token, user, persist = true) => {
    state.token = token;
    state.user = { ...user, permissoes: normalizePermissoes(user.permissoes || {}) };
    if (STORAGE_OK && persist) {
      window.localStorage.setItem(TOKEN_KEY, token);
      window.localStorage.setItem(USER_KEY, JSON.stringify(state.user));
    }
  };

  const clearSession = () => {
    state.token = null;
    state.user = null;
    state.servicos = [];
    state.clientes = [];
    state.comerciais = [];
    state.cotacoes = [];
    state.servicoEditando = null;
    state.clienteEditando = null;
    state.comercialEditando = null;
    resetarInvoice();
    if (temInvoiceUI()) {
      renderInvoiceForm();
      renderInvoiceItens();
      calcularInvoiceResumo();
      setInvoiceStatus('');
    }
    if (STORAGE_OK) {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(USER_KEY);
    }
  };

  const apiRequest = async (path, options = {}) => {
    const { responseType } = options;
    const config = { ...options };
    delete config.responseType;
    config.headers = new Headers(options.headers || {});
    if (state.token) {
      config.headers.set('Authorization', `Bearer ${state.token}`);
    }
    if (config.body && !(config.body instanceof FormData) && !config.headers.has('Content-Type')) {
      config.headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(path, config);
    if (responseType === 'blob') {
      if (!response.ok) {
        const errorText = await response.text();
        let message = errorText || 'Falha ao comunicar com o servidor';
        try {
          const parsed = errorText ? JSON.parse(errorText) : null;
          message = parsed?.message || message;
        } catch (parseError) {
          // ignore parse error, fallback to text/default
        }
        throw new Error(message);
      }
      return await response.blob();
    }
    if (response.status === 204) {
      return null;
    }
    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = text ? { message: text } : null;
    }
    if (!response.ok) {
      const message = data?.message || 'Falha ao comunicar com o servidor';
      throw new Error(message);
    }
    return data;
  };

  const notifyError = (context, error) => {
    console.error(error);
    alert(`${context}: ${error.message || error}`);
  };

  const getCotacoesVisiveis = () => state.cotacoes;
  const podeGerenciarCotacao = cotacao => !cotacao ? false : (isAdminUser() || cotacao.comercialId === getComercialIdAtual());

  const podeAcessarTab = tabName => {
    if (!state.user) return false;
    if (isAdminUser()) return true;
    const permKey = TAB_PERMISSION_MAP[tabName];
    if (!permKey) return false;
    return Boolean(state.user.permissoes?.[permKey]);
  };

  const aplicarPermissoesNasTabs = () => {
    const buttons = document.querySelectorAll('[data-tab]');
    buttons.forEach(btn => {
      const tabName = btn.getAttribute('data-tab');
      if (!state.user) {
        btn.style.display = 'none';
        return;
      }
      btn.style.display = podeAcessarTab(tabName) ? '' : 'none';
    });
  };

  const obterPrimeiraAbaPermitida = () => {
    const ordered = ['dashboard', 'nova-cotacao', 'cotacoes-abertas', 'cotacoes-fechadas', 'clientes', 'comerciais', 'admin'];
    for (const tab of ordered) {
      if (document.querySelector(`[data-tab="${tab}"]`) && podeAcessarTab(tab)) {
        return tab;
      }
    }
    const fallback = document.querySelector('[data-tab]');
    return fallback ? fallback.getAttribute('data-tab') : null;
  };

  const updateUserHeader = () => {
    setText('userName', state.user?.nome || '');
    setText('userRole', state.user ? (isAdminUser() ? 'Administrador' : 'Comercial') : '');
  };

  const atualizarAcoesCotacao = () => {
    const btnFechar = el('btnFecharCotacao');
    if (btnFechar) {
      btnFechar.style.display = isAdminUser() ? 'inline-flex' : 'none';
    }
  };

  const showApp = () => {
    const loginScreen = el('loginScreen');
    const appContainer = el('appContainer');
    if (loginScreen && appContainer) {
      loginScreen.style.display = 'none';
      appContainer.classList.add('active');
    }
    updateUserHeader();
    aplicarPermissoesNasTabs();
    atualizarAcoesCotacao();
    const inicial = obterPrimeiraAbaPermitida();
    if (inicial) {
      switchTab(inicial);
    } else if (state.user) {
      alert('Nenhuma permissão atribuída ao usuário. Contate o administrador.');
    }
  };

  const hideApp = () => {
    const loginScreen = el('loginScreen');
    const appContainer = el('appContainer');
    if (loginScreen && appContainer) {
      loginScreen.style.display = 'flex';
      appContainer.classList.remove('active');
    }
  };

  const toNumber = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const fileToBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const permissoesFormDisponivel = () => Boolean(el('permDashboard'));

  const getPermissoesFromForm = () => {
    if (!permissoesFormDisponivel()) {
      return getDefaultPermissoes();
    }
    return {
      dashboard: el('permDashboard').checked,
      novaCotacao: el('permNovaCotacao').checked,
      cotacoesAbertas: el('permCotacoesAbertas').checked,
      cotacoesFechadas: el('permCotacoesFechadas').checked,
      clientes: el('permClientes').checked,
      comerciais: el('permComerciais').checked,
      adminServicos: el('permAdminServicos').checked,
      adminMaster: el('permAdminMaster').checked
    };
  };

  const preencherPermissoesForm = permissoes => {
    if (!permissoesFormDisponivel()) return;
    const dados = normalizePermissoes(permissoes || {});
    el('permDashboard').checked = dados.dashboard;
    el('permNovaCotacao').checked = dados.novaCotacao;
    el('permCotacoesAbertas').checked = dados.cotacoesAbertas;
    el('permCotacoesFechadas').checked = dados.cotacoesFechadas;
    el('permClientes').checked = dados.clientes;
    el('permComerciais').checked = dados.comerciais;
    el('permAdminServicos').checked = dados.adminServicos;
    el('permAdminMaster').checked = dados.adminMaster;
  };

  const definirPermissoesPadraoForm = () => {
    if (permissoesFormDisponivel()) {
      preencherPermissoesForm(getDefaultPermissoes());
    }
  };

  const atualizarSelectServicos = () => {
    const select = el('cotacaoServico');
    if (!select) return;
    select.innerHTML = '<option value="">Selecione um serviço</option>';
    state.servicos.filter(s => s.status === 'ativo').forEach(servico => {
      const option = document.createElement('option');
      option.value = servico.id;
      const custoDisplay = servico.tipoCusto === 'percentual'
        ? `${servico.valor}%`
        : formatCurrency(servico.valor);
      option.textContent = `${servico.nome} - Custo: ${custoDisplay}`;
      select.appendChild(option);
    });
  };

  const renderServicos = () => {
    atualizarSelectServicos();
    renderCotacaoItens();
    const tabela = el('tabelaServicos');
    if (!tabela) return;
    tabela.innerHTML = '';
    if (state.servicos.length === 0) {
      tabela.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;">Nenhum serviço cadastrado</td></tr>';
      return;
    }
    state.servicos.forEach(servico => {
      const tr = document.createElement('tr');
      const custoDisplay = servico.tipoCusto === 'percentual'
        ? `${servico.valor}%`
        : formatCurrency(servico.valor);
      const tipoDisplay = servico.tipoCusto === 'percentual' ? 'Percentual (%)' : 'Valor Fixo (R$)';
      const idLiteral = jsStringLiteral(servico.id);
      tr.innerHTML = `
        <td><strong>${escapeHtml(servico.nome)}</strong></td>
        <td><span class="badge badge-info">${tipoDisplay}</span></td>
        <td>${custoDisplay}</td>
        <td><span class="badge ${servico.status === 'ativo' ? 'badge-success' : 'badge-warning'}">${servico.status?.toUpperCase() || ''}</span></td>
        <td>${servico.updatedAt ? formatDate(servico.updatedAt) : '-'}</td>
        <td>
          <button class="action-btn action-btn-edit" onclick="editarServico(${idLiteral})">✏️ Editar</button>
          <button class="action-btn action-btn-delete" onclick="excluirServico(${idLiteral})">🗑️ Excluir</button>
        </td>`;
      tabela.appendChild(tr);
    });
  };

  const getServicosAtivos = () => state.servicos.filter(s => s.status === 'ativo');

  const renderCotacaoItens = () => {
    const container = el('cotacaoItensContainer');
    if (!container) return;

    if (state.cotacaoItens.length === 0) {
      container.innerHTML = '<div class="resumo-item resumo-item-empty" data-empty-itens>Utilize o botão abaixo para adicionar até 3 serviços.</div>';
      return;
    }

    const servicosAtivos = getServicosAtivos();
    container.innerHTML = state.cotacaoItens.map((item, index) => {
      const options = ['<option value="">Selecione</option>']
        .concat(servicosAtivos.map(servico => {
          const custoDisplay = servico.tipoCusto === 'percentual'
            ? `${servico.valor}%`
            : formatCurrency(servico.valor);
          const selected = servico.id === item.servicoId ? 'selected' : '';
          return `<option value="${servico.id}" ${selected}>${escapeHtml(servico.nome)} - Custo: ${custoDisplay}</option>`;
        }))
        .join('');
      const disabledRemove = state.cotacaoItens.length === 1 ? 'disabled' : '';
      return `
        <div class="cotacao-item-card">
          <div class="cotacao-item-card__header">
            <span>Serviço ${index + 1}</span>
            <button type="button" class="cotacao-item-remove" ${disabledRemove} onclick="removerItemCotacao('${item.uid}')">🗑️</button>
          </div>
          <div class="cotacao-item-card__body">
            <label class="form-label">Serviço</label>
            <select class="form-select" onchange="atualizarItemCotacaoCampo('${item.uid}', 'servicoId', this.value)">
              ${options}
            </select>
            <label class="form-label">Valor de Venda</label>
            <input type="number" class="form-input" min="0" step="0.01" value="${item.valorVenda}" oninput="atualizarItemCotacaoCampo('${item.uid}', 'valorVenda', this.value)">
          </div>
        </div>
      `;
    }).join('');
  };

  const adicionarItemCotacao = () => {
    if (!temCotacaoMultiUI()) return;
    if (state.cotacaoItens.length >= MAX_COTACAO_ITENS) {
      alert('É possível adicionar no máximo 3 serviços na mesma cotação.');
      return;
    }
    state.cotacaoItens.push(novoItemCotacao());
    renderCotacaoItens();
    calcularCotacao();
  };

  const removerItemCotacao = uid => {
    if (!temCotacaoMultiUI()) return;
    state.cotacaoItens = state.cotacaoItens.filter(item => item.uid !== uid);
    renderCotacaoItens();
    calcularCotacao();
  };

  const atualizarItemCotacaoCampo = (uid, campo, valor) => {
    if (!temCotacaoMultiUI()) return;
    const item = state.cotacaoItens.find(it => it.uid === uid);
    if (!item) return;
    if (campo === 'valorVenda') {
      item.valorVenda = valor;
    } else if (campo === 'servicoId') {
      item.servicoId = valor;
    }
    calcularCotacao();
  };

  const coletarItensCotacaoParaEnvio = () => {
    if (temCotacaoMultiUI()) {
      const itensValidos = state.cotacaoItens
        .map(item => ({
          servicoId: item.servicoId,
          valorVenda: toNumber(item.valorVenda)
        }))
        .filter(item => item.servicoId && item.valorVenda > 0);
      if (itensValidos.length === 0) {
        throw new Error('Adicione ao menos um serviço com valor de venda.');
      }
      return itensValidos.slice(0, MAX_COTACAO_ITENS);
    }
    const servicoId = el('cotacaoServico')?.value;
    const valorVenda = toNumber(el('valorVenda')?.value);
    if (!servicoId || !valorVenda) {
      throw new Error('Preencha cliente, serviço e valor de venda.');
    }
    return [{ servicoId, valorVenda }];
  };

  const obterMoedaDaCotacao = () => {
    if (temCotacaoMultiUI()) {
      const select = el('cotacaoMoeda');
      const moeda = select ? (select.value || 'BRL') : 'BRL';
      state.cotacaoMoeda = moeda;
      return moeda;
    }
    return 'BRL';
  };

  const setInvoiceStatus = (message, type = '') => {
    const box = el('invoiceStatusMessage');
    if (!box) return;
    box.textContent = message || '';
    box.classList.remove('success', 'error');
    if (!message) {
      box.style.display = 'none';
      return;
    }
    if (type === 'success') box.classList.add('success');
    if (type === 'error') box.classList.add('error');
    box.style.display = 'block';
  };

  const atualizarSelectClientesInvoice = () => {
    const select = el('invoiceCliente');
    if (!select) return;
    const selecionado = state.invoiceForm?.clienteId || '';
    select.innerHTML = '<option value="">Selecione um cliente cadastrado</option>';
    state.clientes.forEach(cliente => {
      const option = document.createElement('option');
      option.value = cliente.id;
      option.textContent = cliente.nome;
      select.appendChild(option);
    });
    select.value = selecionado && state.clientes.some(c => c.id === selecionado) ? selecionado : '';
  };

  const renderInvoiceHistorico = () => {
    const tbody = el('invoiceHistoricoBody');
    if (!tbody) return;
    if (!state.invoiceHistorico.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:12px; color: var(--text-secondary);">Nenhuma invoice gerada ainda.</td></tr>';
      return;
    }
    tbody.innerHTML = state.invoiceHistorico.map(inv => {
      const data = inv.createdAt ? formatDate(inv.createdAt) : (inv.invoiceDate || '-');
      const totalFmt = formatCurrencyByMoeda(inv.total || 0, inv.currency || 'USD');
      const cliente = escapeHtml(inv.customerName || '-');
      const numero = escapeHtml(inv.number);
      return `
        <tr>
          <td>${numero}</td>
          <td>${data}</td>
          <td>${cliente}</td>
          <td>${totalFmt}</td>
          <td style="display:flex; gap:6px; justify-content:center;">
            <button class="action-btn" onclick="baixarInvoicePdf('${numero}')">⬇️ PDF</button>
            <button class="action-btn action-btn-delete" onclick="deletarInvoice('${numero}')">🗑️ Excluir</button>
          </td>
        </tr>
      `;
    }).join('');
  };

  const fetchInvoiceHistorico = async () => {
    if (!isAdminUser()) {
      setInvoiceStatus('Apenas administradores podem ver o histórico.', 'error');
      return;
    }
    try {
      const data = await apiRequest('/invoices');
      state.invoiceHistorico = Array.isArray(data) ? data : [];
      renderInvoiceHistorico();
    } catch (error) {
      setInvoiceStatus(error.message || 'Erro ao carregar histórico de invoices.', 'error');
    }
  };

  const baixarInvoicePdf = async (numero) => {
    if (!numero) return;
    try {
      setInvoiceStatus(`Baixando invoice ${numero}...`, '');
      const blob = await apiRequest(`/invoices/${encodeURIComponent(numero)}/pdf`, {
        method: 'GET',
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${numero}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setInvoiceStatus('Download iniciado.', 'success');
    } catch (error) {
      setInvoiceStatus(error.message || 'Erro ao baixar invoice.', 'error');
    }
  };

  const deletarInvoice = async (numero) => {
    if (!numero) return;
    if (!confirm(`Excluir a invoice ${numero}?`)) return;
    try {
      await apiRequest(`/invoices/${encodeURIComponent(numero)}`, { method: 'DELETE' });
      setInvoiceStatus(`Invoice ${numero} excluída.`, 'success');
      fetchInvoiceHistorico();
    } catch (error) {
      setInvoiceStatus(error.message || 'Erro ao excluir invoice.', 'error');
    }
  };

  const renderInvoiceForm = () => {
    if (!temInvoiceUI()) return;
    const form = state.invoiceForm || getDefaultInvoiceForm();
    atualizarSelectClientesInvoice();
    setValue('invoiceClienteNome', form.clienteNome || '');
    setValue('invoiceClienteTaxId', form.clienteTaxId || '');
    setValue('invoiceClienteContato', form.clienteContato || '');
    setValue('invoiceClienteEmail', form.clienteEmail || '');
    setValue('invoiceClienteTelefone', form.clienteTelefone || '');
    setValue('invoiceClienteEndereco', form.clienteEndereco || '');
    setValue('invoiceNumero', form.invoiceNumber || '');
    setValue('invoiceData', form.invoiceDate || getDefaultInvoiceForm().invoiceDate);
    setValue('invoicePaymentTerms', form.paymentTerms || '');
    setValue('invoiceDeliveryTerms', form.deliveryTerms || '');
    setValue('invoiceLanguage', form.language || 'pt');
    setValue('invoiceObservacoes', form.observacoes || '');
    setValue('invoiceBankName', form.bankName || '');
    setValue('invoiceBankSwift', form.bankSwift || '');
    setValue('invoiceBankBranch', form.bankBranch || '');
    setValue('invoiceBankAccount', form.bankAccount || '');
    setValue('invoiceBankBeneficiary', form.bankBeneficiary || '');
    setValue('invoiceBankBeneficiaryAddress', form.bankBeneficiaryAddress || '');
    setValue('invoiceIntermediaryBank', form.intermediaryBank || '');
    setValue('invoiceIntermediarySwift', form.intermediarySwift || '');
    setValue('invoiceDesconto', form.desconto || '');
    setValue('invoicePaisOrigem', form.countryOfOrigin || '');
    setValue('invoiceHsCode', form.hsCode || '');
    setValue('invoiceDeliveryInfo', form.deliveryInfo || '');
    const moedaSelect = el('invoiceMoeda');
    if (moedaSelect) {
      moedaSelect.value = form.moeda || 'USD';
    }
    const langSelect = el('invoiceLanguage');
    if (langSelect) {
      langSelect.value = form.language || 'pt';
    }
  };

  const coletarInvoiceFormDoDom = () => {
    prepararEstadoInvoice();
    const form = state.invoiceForm;
    form.clienteId = (el('invoiceCliente')?.value || '').trim();
    form.clienteNome = (el('invoiceClienteNome')?.value || '').trim();
    form.clienteTaxId = (el('invoiceClienteTaxId')?.value || '').trim();
    form.clienteContato = (el('invoiceClienteContato')?.value || '').trim();
    form.clienteEmail = (el('invoiceClienteEmail')?.value || '').trim();
    form.clienteTelefone = (el('invoiceClienteTelefone')?.value || '').trim();
    form.clienteEndereco = (el('invoiceClienteEndereco')?.value || '').trim();
    form.invoiceNumber = '';
    form.invoiceDate = (el('invoiceData')?.value || form.invoiceDate || getDefaultInvoiceForm().invoiceDate);
    form.moeda = normalizarMoedaLocal(el('invoiceMoeda')?.value || form.moeda || 'USD');
    form.language = (el('invoiceLanguage')?.value || form.language || 'pt').trim() || 'pt';
    form.paymentTerms = (el('invoicePaymentTerms')?.value || form.paymentTerms || '').trim();
    form.deliveryTerms = (el('invoiceDeliveryTerms')?.value || form.deliveryTerms || '').trim();
    form.observacoes = (el('invoiceObservacoes')?.value || '').trim();
    form.bankName = (el('invoiceBankName')?.value || '').trim();
    form.bankSwift = (el('invoiceBankSwift')?.value || '').trim();
    form.bankBranch = (el('invoiceBankBranch')?.value || '').trim();
    form.bankAccount = (el('invoiceBankAccount')?.value || '').trim();
    form.bankBeneficiary = (el('invoiceBankBeneficiary')?.value || '').trim();
    form.bankBeneficiaryAddress = (el('invoiceBankBeneficiaryAddress')?.value || '').trim();
    form.intermediaryBank = (el('invoiceIntermediaryBank')?.value || '').trim();
    form.intermediarySwift = (el('invoiceIntermediarySwift')?.value || '').trim();
    form.desconto = toNumber(el('invoiceDesconto')?.value ?? form.desconto);
    return form;
  };

  const preencherDadosClienteInvoice = clienteId => {
    prepararEstadoInvoice();
    const form = state.invoiceForm;
    form.clienteId = clienteId || '';
    const cliente = state.clientes.find(c => c.id === clienteId);
    if (cliente) {
      form.clienteNome = cliente.nome || '';
      form.clienteTaxId = cliente.documento || '';
      form.clienteContato = cliente.contato || cliente.telefone || '';
      form.clienteEmail = cliente.email || '';
      form.clienteTelefone = cliente.telefone || '';
      form.clienteEndereco = cliente.endereco || '';
      form.customerNumber = cliente.id || form.customerNumber;
      form.paymentTerms = cliente.invoicePaymentTerms || form.paymentTerms;
      form.deliveryTerms = cliente.invoiceDeliveryTerms || form.deliveryTerms;
      form.countryOfOrigin = cliente.countryOfOrigin || form.countryOfOrigin;
      form.hsCode = cliente.hsCode || form.hsCode;
      form.deliveryInfo = cliente.deliveryInfo || form.deliveryInfo;
      form.shippingMethod = cliente.shippingMethod || form.shippingMethod;
      form.bankName = cliente.bankName || form.bankName;
      form.bankSwift = cliente.bankSwift || form.bankSwift;
      form.bankBranch = cliente.bankBranch || form.bankBranch;
      form.bankAccount = cliente.bankAccount || form.bankAccount;
      form.bankBeneficiary = cliente.bankBeneficiary || form.bankBeneficiary;
      form.bankBeneficiaryAddress = cliente.bankBeneficiaryAddress || form.bankBeneficiaryAddress;
      form.intermediaryBank = cliente.intermediaryBank || form.intermediaryBank;
      form.intermediarySwift = cliente.intermediarySwift || form.intermediarySwift;
    } else if (!clienteId) {
      Object.assign(form, {
        clienteNome: '',
        clienteTaxId: '',
        clienteContato: '',
        clienteEmail: '',
        clienteTelefone: '',
        clienteEndereco: ''
      });
    }
    renderInvoiceForm();
    setInvoiceStatus('');
  };

  const atualizarInvoiceCampo = (campo, valor) => {
    prepararEstadoInvoice();
    const form = state.invoiceForm;
    if (campo === 'moeda') {
      form.moeda = normalizarMoedaLocal(valor);
      renderInvoiceItens();
    } else if (campo === 'desconto') {
      form[campo] = Math.max(0, toNumber(valor));
    } else {
      form[campo] = valor;
    }
    if (['moeda', 'desconto'].includes(campo)) {
      calcularInvoiceResumo();
    }
    if (['invoicePaymentTerms', 'invoiceDeliveryTerms', 'countryOfOrigin', 'hsCode', 'deliveryInfo', 'shippingMethod', 'bankName', 'bankSwift', 'bankBranch', 'bankAccount', 'bankBeneficiary', 'bankBeneficiaryAddress', 'intermediaryBank', 'intermediarySwift'].includes(campo)) {
      // keep values in form; recalculation not needed here
    }
  };

  const numberToWordsEN = num => {
    const units = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    const scales = ['', 'thousand', 'million', 'billion'];

    if (num === 0) return 'zero';

    const chunkToWords = value => {
      let words = [];
      const hundred = Math.floor(value / 100);
      const remainder = value % 100;
      if (hundred) {
        words.push(`${units[hundred]} hundred`);
      }
      if (remainder) {
        if (remainder < 20) {
          words.push(units[remainder]);
        } else {
          const ten = Math.floor(remainder / 10);
          const unit = remainder % 10;
          words.push(tens[ten] + (unit ? `-${units[unit]}` : ''));
        }
      }
      return words.join(' ');
    };

    const parts = [];
    let remaining = num;
    let scaleIndex = 0;
    while (remaining > 0 && scaleIndex < scales.length) {
      const chunk = remaining % 1000;
      if (chunk) {
        const chunkWords = chunkToWords(chunk);
        const scale = scales[scaleIndex];
        parts.unshift(scale ? `${chunkWords} ${scale}` : chunkWords);
      }
      remaining = Math.floor(remaining / 1000);
      scaleIndex += 1;
    }
    return parts.join(' ');
  };

  const gerarValorPorExtenso = (valor, moeda = 'USD') => {
    const currencyLabel = moeda === 'BRL' ? 'reais' : 'dollars';
    const centsLabel = moeda === 'BRL' ? 'centavos' : 'cents';
    const absoluto = Math.abs(valor);
    const inteiro = Math.floor(absoluto);
    const centavos = Math.round((absoluto - inteiro) * 100);
    const inteiroTexto = numberToWordsEN(inteiro);
    const centavosTexto = centavos ? numberToWordsEN(centavos) : '';
    const partes = [];
    if (inteiroTexto && inteiroTexto !== 'zero') {
      partes.push(`${inteiroTexto} ${currencyLabel}`);
    } else {
      partes.push(`zero ${currencyLabel}`);
    }
    if (centavosTexto) {
      partes.push(`${centavosTexto} ${centsLabel}`);
    }
    const prefixo = valor < 0 ? 'negative ' : '';
    return (prefixo + partes.join(' and ')).toUpperCase();
  };

  const renderInvoiceItens = () => {
    const container = el('invoiceItensContainer');
    if (!container) return;
    if (!state.invoiceItens.length) {
      container.innerHTML = '<div class="resumo-item resumo-item-empty" data-empty-invoice>Utilize o botão abaixo para adicionar até 3 serviços.</div>';
      return;
    }
    const moeda = state.invoiceForm?.moeda || 'USD';
    container.innerHTML = state.invoiceItens.map((item, index) => {
      const disabledRemove = state.invoiceItens.length === 1 ? 'disabled' : '';
      const qty = item.quantity ?? '';
      const unitPrice = item.unitPrice ?? '';
      return `
        <div class="invoice-item-card">
          <div class="invoice-item-header">
            <span>Item ${index + 1}</span>
            <button type="button" class="cotacao-item-remove" ${disabledRemove} onclick="removerInvoiceItem('${item.uid}')">🗑️</button>
          </div>
          <div class="form-group" style="margin:0; margin-top: 5px;">
            <label class="form-label">Referência</label>
            <input type="text" class="form-input" value="${escapeHtml(item.reference || '')}" oninput="atualizarInvoiceItemCampo('${item.uid}', 'reference', this.value)">
          </div>
          <label class="form-label">Descrição</label>
          <textarea class="form-textarea" rows="2" oninput="atualizarInvoiceItemCampo('${item.uid}', 'description', this.value)">${escapeHtml(item.description || '')}</textarea>
          <div class="grid-2" style="margin-top: 10px;">
            <div class="form-group" style="margin:0;">
              <label class="form-label">Data do Serviço</label>
              <input type="date" class="form-input" value="${item.serviceDate || ''}" oninput="atualizarInvoiceItemCampo('${item.uid}', 'serviceDate', this.value)">
            </div>
            <div class="form-group" style="margin:0;">
              <label class="form-label">Valor (USD)</label>
              <input type="number" class="form-input" min="0" step="0.01" value="${unitPrice}" oninput="atualizarInvoiceItemCampo('${item.uid}', 'unitPrice', this.value)">
            </div>
          </div>
        </div>
      `;
    }).join('');
  };

  const adicionarInvoiceItem = () => {
    if (!temInvoiceUI()) return;
    if (state.invoiceItens.length >= MAX_INVOICE_ITENS) {
      alert('É possível adicionar no máximo 3 itens na mesma invoice.');
      return;
    }
    state.invoiceItens.push(novoInvoiceItem());
    renderInvoiceItens();
    calcularInvoiceResumo();
  };

  const removerInvoiceItem = uid => {
    if (!temInvoiceUI()) return;
    state.invoiceItens = state.invoiceItens.filter(item => item.uid !== uid);
    if (state.invoiceItens.length === 0) {
      state.invoiceItens = [novoInvoiceItem()];
    }
    renderInvoiceItens();
    calcularInvoiceResumo();
  };

  const atualizarInvoiceItemCampo = (uid, campo, valor) => {
    if (!temInvoiceUI()) return;
    const item = state.invoiceItens.find(it => it.uid === uid);
    if (!item) return;
    item[campo] = valor;
    calcularInvoiceResumo();
  };

  const calcularInvoiceResumo = () => {
    if (!temInvoiceUI()) return;
    const form = coletarInvoiceFormDoDom();
    const moeda = form.moeda || 'USD';
    const subtotal = state.invoiceItens.reduce((acc, item) => {
      const qty = toNumber(item.quantity);
      const effectiveQty = item.tipo === 'service' ? (qty > 0 ? qty : 1) : qty;
      const price = toNumber(item.unitPrice);
      if (effectiveQty <= 0 || price <= 0) return acc;
      return acc + (effectiveQty * price);
    }, 0);
    const desconto = Math.min(Math.max(0, toNumber(form.desconto)), subtotal);
    const total = subtotal - desconto;
    form.desconto = desconto;
    form.amountInWords = gerarValorPorExtenso(total, moeda);
    setText('invoiceResumoSubtotal', formatCurrencyByMoeda(subtotal, moeda));
    setText('invoiceResumoDesconto', formatCurrencyByMoeda(desconto, moeda));
    setText('invoiceResumoTotal', formatCurrencyByMoeda(total, moeda));
    setText('invoiceResumoExtenso', total ? form.amountInWords : '--');
  };

  const montarPayloadInvoice = () => {
    const form = coletarInvoiceFormDoDom();
    const services = state.invoiceItens
      .map(item => {
        const unitPrice = toNumber(item.unitPrice);
        return {
          description: (item.description || '').trim(),
          serviceDate: item.serviceDate || '',
          reference: (item.reference || '').trim(),
          amount: unitPrice
        };
      })
      .filter(s => s.description && s.amount > 0)
      .slice(0, MAX_INVOICE_ITENS);
    if (!services.length) {
      throw new Error('Inclua ao menos um serviço com valor.');
    }
    if (!form.clienteNome) {
      throw new Error('Preencha os dados do cliente para a invoice.');
    }
    if (!form.bankName?.trim()) {
      throw new Error('Informe o banco do cliente.');
    }
    if (!form.bankBeneficiaryAddress?.trim()) {
      throw new Error('Informe o endereço do banco do cliente.');
    }
    if (!form.bankSwift?.trim()) {
      throw new Error('Informe o código SWIFT do beneficiário.');
    }
    const subtotal = services.reduce((sum, s) => sum + s.amount, 0);
    const desconto = Math.min(Math.max(0, toNumber(form.desconto)), subtotal);
    const total = subtotal - desconto;
    const amountInWords = gerarValorPorExtenso(total, form.moeda);

    form.desconto = desconto;
    form.amountInWords = amountInWords;

    const clienteNome = form.clienteNome || 'CLIENTE';
    const clienteEndereco = form.clienteEndereco || '';
    const clienteTelefone = form.clienteTelefone || '';
    const bankBeneficiary = form.bankBeneficiary || clienteNome;
    const invoiceNumber = (form.invoiceNumber && form.invoiceNumber.trim())
      || `INV-${(form.invoiceDate || getDefaultInvoiceForm().invoiceDate).replace(/-/g, '')}`;
    const issueDate = formatInvoiceIssueDate(form.invoiceDate);

    return {
      clienteId: form.clienteId || undefined,
      customerName: form.clienteNome,
      customerAddressLine1: form.clienteEndereco,
      customerAddressLine2: '',
      customerCityState: '',
      customerCountry: '',
      customerTaxId: form.clienteTaxId,
      customerEmail: form.clienteEmail,
      customerPhone: form.clienteTelefone || form.clienteContato,
      customerContact: form.clienteContato,
      invoiceNumber,
      invoiceDate: form.invoiceDate || getDefaultInvoiceForm().invoiceDate,
      customerNumber: form.customerNumber || form.clienteId,
      paymentTerms: form.paymentTerms || 'Prepayment',
      deliveryTerms: form.deliveryTerms || 'FOB',
      services,
      discount: desconto,
      shipping: 0,
      countryOfOrigin: undefined,
      hsCode: undefined,
      deliveryInfo: undefined,
      shippingMethod: undefined,
      bankName: form.bankName,
      swiftCode: form.bankSwift,
      bankBranch: form.bankBranch,
      beneficiaryAccount: form.bankAccount,
      iban: form.bankAccount,
      beneficiaryName: bankBeneficiary,
      beneficiaryAddress: form.bankBeneficiaryAddress,
      intermediaryBank: form.intermediaryBank,
      intermediarySwift: form.intermediarySwift,
      acknowledgementText: form.observacoes,
      signatureName: state.user?.nome || 'Zenith Pay',
      extraNotes: form.observacoes ? [form.observacoes] : [],
      amountInWords,
      moeda: form.moeda,
      language: form.language || 'pt',
      exporterCompany: clienteNome,
      exporterAddress: clienteEndereco,
      exporterPhone: clienteTelefone ? `Tel: ${clienteTelefone}` : '',
      payerCompany: 'C. N PAGAMENTOS ONLINE LTDA',
      payerTradeName: 'ZENITH PAY',
      payerAddress: 'R. WASHINGTON LUIS, 59, LOTE 10B, QUADRA 43, CXPST 20, CENTRO, NOSSA SENHORA DAS GRACAS, PR',
      payerZipCode: '86.680-000',
      payerTaxId: '53.213.723/0001-35',
      bankAccountNumber: form.bankAccount,
      bankAddress: form.bankBeneficiaryAddress,
      bankBeneficiary,
      bankName: form.bankName,
      bankSwift: form.bankSwift,
      intermediaryBank: form.intermediaryBank,
      intermediarySwift: form.intermediarySwift,
      issueDate,
      signatoryCompany: clienteNome
    };
  };

  const limparInvoiceForm = () => {
    resetarInvoice();
    renderInvoiceForm();
    renderInvoiceItens();
    calcularInvoiceResumo();
    setInvoiceStatus('');
  };

  const gerarInvoice = async () => {
    if (!temInvoiceUI()) return;
    if (!isAdminUser()) {
      setInvoiceStatus('Apenas administradores podem gerar invoices.', 'error');
      return;
    }
    let payload;
    try {
      payload = montarPayloadInvoice();
    } catch (error) {
      setInvoiceStatus(error.message || 'Erro ao preparar invoice.', 'error');
      return;
    }
    setInvoiceStatus('Gerando invoice em PDF...', '');
    try {
      const blob = await apiRequest('/invoices/commercial', {
        method: 'POST',
        body: JSON.stringify(payload),
        responseType: 'blob'
      });
      const nomeArquivoBase = (payload.invoiceNumber || 'invoice-zenith')
        .toString()
        .trim()
        .replace(/[^a-z0-9-_]+/gi, '-')
        .replace(/^-+|-+$/g, '') || 'invoice-zenith';
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${nomeArquivoBase}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setInvoiceStatus('Invoice gerada com sucesso! O download foi iniciado.', 'success');
      fetchInvoiceHistorico();
    } catch (error) {
      setInvoiceStatus(error.message || 'Erro ao gerar invoice.', 'error');
    }
  };

  const renderClientes = () => {
    const select = el('cotacaoCliente');
    if (select) {
      select.innerHTML = '<option value="">Selecione um cliente</option>';
      state.clientes.forEach(cliente => {
        const option = document.createElement('option');
        option.value = cliente.id;
        option.textContent = cliente.nome;
        select.appendChild(option);
      });
    }
    atualizarSelectClientesInvoice();
    const tabela = el('tabelaClientes');
    if (!tabela) return;
    const cotacoesVisiveis = getCotacoesVisiveis();
    if (state.clientes.length === 0) {
      tabela.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;">Nenhum cliente cadastrado</td></tr>';
      return;
    }
    tabela.innerHTML = '';
    state.clientes.forEach(cliente => {
      const cotacoesClienteLista = cotacoesVisiveis.filter(c => c.clienteId === cliente.id);
      const cotacoesClienteFechadas = cotacoesClienteLista.filter(c => c.status === 'fechada');
      const totalMapa = {};
      cotacoesClienteFechadas.forEach(cot => {
        adicionarValorPorMoeda(totalMapa, cot.moeda || 'BRL', cot.valorVenda);
      });
      const totalMov = formatMapaMoedas(totalMapa);
      const cotacoesCliente = cotacoesClienteLista.length;
      const idLiteral = jsStringLiteral(cliente.id);
      tabela.innerHTML += `
        <tr>
          <td><strong>${escapeHtml(cliente.nome)}</strong></td>
          <td>${escapeHtml(cliente.documento)}</td>
          <td>${escapeHtml(cliente.telefone || '')}</td>
          <td>${totalMov}</td>
          <td>${cotacoesCliente}</td>
          <td>
            <button class="action-btn" onclick="verHistoricoCliente(${idLiteral})">📖 Histórico</button>
            <button class="action-btn action-btn-edit" onclick="editarCliente(${idLiteral})">✏️ Editar</button>
            <button class="action-btn action-btn-delete" onclick="excluirCliente(${idLiteral})">🗑️ Excluir</button>
          </td>
        </tr>`;
    });
  };

  const renderComerciais = () => {
    const tabela = el('tabelaComerciais');
    if (!tabela) return;
    if (!isAdminUser()) {
      tabela.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;">Apenas administradores podem visualizar esta seção.</td></tr>';
      return;
    }
    if (state.comerciais.length === 0) {
      tabela.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;">Nenhum comercial cadastrado</td></tr>';
      return;
    }
    tabela.innerHTML = '';
    state.comerciais.forEach(comercial => {
      const permissoes = normalizePermissoes(comercial.permissoes);
      const badges = Object.entries(PERMISSOES_LABELS)
        .filter(([key]) => permissoes[key])
        .map(([, label]) => `<span class="badge badge-info">${label}</span>`)
        .join(' ');
      const idLiteral = jsStringLiteral(comercial.id);
      tabela.innerHTML += `
        <tr>
          <td><strong>${escapeHtml(comercial.nome)}</strong></td>
          <td>${escapeHtml(comercial.cpf)}</td>
          <td>${escapeHtml(comercial.pix)}</td>
          <td>${badges || '<span class="badge badge-warning">Sem acesso</span>'}</td>
          <td><span class="badge ${comercial.status === 'ativo' ? 'badge-success' : 'badge-warning'}">${comercial.status?.toUpperCase() || ''}</span></td>
          <td>${formatDate(comercial.createdAt)}</td>
          <td>
            <button class="action-btn action-btn-edit" onclick="editarComercial(${idLiteral})">✏️ Editar</button>
            <button class="action-btn action-btn-delete" onclick="excluirComercial(${idLiteral})">🗑️ Excluir</button>
          </td>
        </tr>`;
    });
  };

  const renderCotacoes = () => {
    renderCotacoesAbertas();
    renderCotacoesFechadas();
    atualizarDashboard();
  };

  const renderCotacoesAbertas = (lista = null) => {
    const tabela = el('tabelaCotacoesAbertas');
    if (!tabela) return;
    const abertas = (lista || getCotacoesVisiveis()).filter(c => c.status === 'analise' || c.status === 'aguardando');
    if (abertas.length === 0) {
      tabela.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;">Nenhuma cotação em aberto</td></tr>';
      return;
    }
    tabela.innerHTML = '';
    const adminPodeFechar = isAdminUser();
    abertas.forEach(cot => {
      const statusLabel = cot.status === 'analise' ? 'Em Análise' : 'Aguardando Confirmação';
      const badgeClass = cot.status === 'analise' ? 'badge-warning' : 'badge-info';
      const idLiteral = jsStringLiteral(cot.id);
      const botoesAcao = [];
      if (adminPodeFechar) {
        botoesAcao.push(`<button class="action-btn action-btn-edit" onclick="mudarStatusCotacao(${idLiteral}, 'fechada')">✓ Fechar</button>`);
      }
      botoesAcao.push(`<button class="action-btn action-btn-delete" onclick="excluirCotacao(${idLiteral})">🗑️ Excluir</button>`);
      tabela.innerHTML += `
        <tr>
          <td>${cot.createdAt ? formatDate(cot.createdAt) : '-'}</td>
          <td><strong>${escapeHtml(cot.clienteNome)}</strong></td>
          <td>${formatarServicosCotacaoHtml(cot)}</td>
          <td style="color: var(--accent-gold); font-weight: 700;">${formatarTotalCotacaoPorCampo(cot, 'valorVenda')}</td>
          <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
          <td>
            ${botoesAcao.join(' ')}
          </td>
        </tr>`;
    });
  };

  const renderCotacoesFechadas = (lista = null) => {
    const tabela = el('tabelaCotacoesFechadas');
    if (!tabela) return;
    const fechadas = (lista || getCotacoesVisiveis()).filter(c => c.status === 'fechada');
    if (fechadas.length === 0) {
      tabela.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;">Nenhuma cotação fechada</td></tr>';
      return;
    }
    tabela.innerHTML = '';
    fechadas.forEach(cot => {
      const idLiteral = jsStringLiteral(cot.id);
      tabela.innerHTML += `
        <tr>
          <td>${cot.createdAt ? formatDate(cot.createdAt) : '-'}</td>
          <td><strong>${escapeHtml(cot.clienteNome)}</strong></td>
          <td>${formatarServicosCotacaoHtml(cot)}</td>
          <td style="color: var(--accent-gold); font-weight: 700;">${formatarTotalCotacaoPorCampo(cot, 'valorVenda')}</td>
          <td style="color: var(--success); font-weight: 700;">${formatarTotalCotacaoPorCampo(cot, 'comissao')}</td>
          <td>
            <button class="action-btn action-btn-delete" onclick="excluirCotacao(${idLiteral})">🗑️ Excluir</button>
          </td>
        </tr>`;
    });
  };

  const atualizarDashboard = () => {
    const base = getCotacoesVisiveis();
    const abertas = base.filter(c => c.status === 'analise' || c.status === 'aguardando').length;
    const fechadas = base.filter(c => c.status === 'fechada').length;
    const mapaValorTotal = {};
    base
      .filter(c => c.status === 'fechada')
      .forEach(c => {
        const mapaCotacao = calcularMapaCotacaoPorCampo(c, 'valorVenda');
        mesclarMapaMoedas(mapaValorTotal, mapaCotacao);
      });
    const clientesSet = new Set(base.map(c => c.clienteId));
    const totalClientesIndicador = isAdminUser() ? state.clientes.length : clientesSet.size;
    setText('totalAberto', abertas);
    setText('totalFechado', fechadas);
    setText('valorTotal', formatMapaMoedas(mapaValorTotal));
    setText('totalClientes', totalClientesIndicador);
  };

  const fetchServicos = async () => {
    try {
      const data = await apiRequest('/servicos');
      state.servicos = Array.isArray(data) ? data : [];
      renderServicos();
    } catch (error) {
      notifyError('Erro ao carregar serviços', error);
    }
  };

  const fetchClientes = async () => {
    try {
      const data = await apiRequest('/clientes');
      state.clientes = Array.isArray(data) ? data : [];
      renderClientes();
    } catch (error) {
      notifyError('Erro ao carregar clientes', error);
    }
  };

  const fetchComerciais = async () => {
    if (!el('tabelaComerciais') || !isAdminUser()) {
      renderComerciais();
      return;
    }
    try {
      const data = await apiRequest('/comerciais');
      state.comerciais = Array.isArray(data) ? data : [];
      renderComerciais();
    } catch (error) {
      notifyError('Erro ao carregar comerciais', error);
    }
  };

  const fetchCotacoes = async () => {
    try {
      const data = await apiRequest('/cotacoes');
      state.cotacoes = Array.isArray(data) ? data : [];
      renderCotacoes();
    } catch (error) {
      notifyError('Erro ao carregar cotações', error);
    }
  };

  const kycStatusBadge = status => ({
    PENDENTE: 'badge-warning',
    APROVADO: 'badge-success',
    REPROVADO: 'badge-danger'
  }[status] || 'badge-info');

  const kycStatusLabel = status => ({
    PENDENTE: 'Pendente',
    APROVADO: 'Aprovado',
    REPROVADO: 'Reprovado'
  }[status] || status || '-');

  const renderKycDocumento = (url, label) => {
    if (!url) return '';
    const safeUrl = escapeHtml(url);
    const normalized = (url.split('?')[0] || '').toLowerCase();
    const extMatch = normalized.match(/\.([a-z0-9]+)$/);
    const ext = extMatch ? extMatch[1] : '';
    const isImagem = /^data:image\//i.test(url) || /\.(png|jpe?g|gif|webp)$/i.test(normalized);
    const isPdf = /^data:application\/pdf/i.test(url) || ext === 'pdf';
    const isDoc = /^data:application\/msword/i.test(url) || ext === 'doc';
    const isDocx = /^data:application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/i.test(url) || ext === 'docx';
    if (isImagem) {
      return `<div class="kyc-doc">
        <div class="kyc-doc-label">${label}</div>
        <img src="${safeUrl}" alt="${label}" />
      </div>`;
    }
    const icon = isPdf ? '📄 PDF' : (isDoc || isDocx ? '📝 Documento' : '📎 Arquivo');
    return `<div class="kyc-doc">
      <div class="kyc-doc-label">${label}</div>
      <a class="kyc-doc-link" href="${safeUrl}" target="_blank" rel="noopener">${icon} - Abrir</a>
    </div>`;
  };

  const abrirKycDocumentos = id => {
    if (!isAdminUser()) return;
    const registro = state.kycRegistros.find(item => item.id === id);
    const modal = el('kycDocumentModal');
    const backdrop = el('kycModalBackdrop');
    const docsContainer = el('kycModalDocs');
    const titulo = el('kycModalTitulo');
    if (!registro || !modal || !docsContainer) return;
    const docs = [
      renderKycDocumento(registro.documentoUrl, 'Documento'),
      renderKycDocumento(registro.selfieUrl, 'Selfie')
    ].filter(Boolean).join('') || '<div class="kyc-doc">Nenhum documento enviado.</div>';
    docsContainer.innerHTML = docs;
    if (titulo) {
      titulo.textContent = `Documentos - ${registro.nome || ''}`;
    }
    modal.classList.add('active');
    if (backdrop) backdrop.classList.add('active');
  };

  const fecharKycDocumentos = () => {
    const modal = el('kycDocumentModal');
    const backdrop = el('kycModalBackdrop');
    const docsContainer = el('kycModalDocs');
    if (docsContainer) docsContainer.innerHTML = '';
    if (modal) modal.classList.remove('active');
    if (backdrop) backdrop.classList.remove('active');
  };

  const renderKycLista = () => {
    const lista = el('kycLista');
    const empty = el('kycEmpty');
    if (!lista) return;
    if (!isAdminUser()) {
      lista.innerHTML = '<div class="kyc-card" style="text-align:center;">Disponível apenas para administradores.</div>';
      if (empty) empty.style.display = 'none';
      return;
    }
    const busca = (el('kycBusca')?.value || '').toLowerCase();
    let registros = Array.isArray(state.kycRegistros) ? [...state.kycRegistros] : [];
    if (busca) {
      registros = registros.filter(reg =>
        reg.nome?.toLowerCase().includes(busca) ||
        reg.cpf?.toLowerCase().includes(busca) ||
        reg.pix?.toLowerCase().includes(busca)
      );
    }
    if (registros.length === 0) {
      lista.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }
    const cards = registros.map(reg => {
      const obsId = `kycObs-${reg.id}`;
      const idLiteral = jsStringLiteral(reg.id);
      const documentos = [reg.documentoUrl, reg.selfieUrl].filter(Boolean);
      const docsSection = documentos.length
        ? `<button class="kyc-doc-icon" onclick="abrirKycDocumentos(${idLiteral})">📎 Ver documentos (${documentos.length})</button>`
        : '<span class="kyc-documents-empty">Nenhum documento enviado.</span>';
      return `
        <div class="kyc-card">
          <div class="kyc-card-header">
            <h4>${escapeHtml(reg.nome)}</h4>
            <span class="badge ${kycStatusBadge(reg.kycStatus)}">${kycStatusLabel(reg.kycStatus)}</span>
          </div>
          <div class="kyc-meta">
            <div><strong>CPF:</strong> ${escapeHtml(reg.cpf || '-')}</div>
            <div><strong>PIX:</strong> ${escapeHtml(reg.pix || '-')}</div>
            <div><strong>Enviado em:</strong> ${formatDate(reg.createdAt)}</div>
            <div><strong>Última revisão:</strong> ${reg.kycRevisadoEm ? `${formatDate(reg.kycRevisadoEm)} por ${escapeHtml(reg.kycRevisorNome || '-')}` : '-'}</div>
          </div>
          <div class="kyc-documents">
            ${docsSection}
          </div>
          <div class="kyc-actions">
            <textarea id="${obsId}" class="form-input" placeholder="Observações para o comercial">${escapeHtml(reg.kycObservacao || '')}</textarea>
            <div class="kyc-action-buttons">
              <button class="btn btn-success" onclick="atualizarKycStatus(${idLiteral}, 'APROVADO')">✅ Aprovar</button>
              <button class="btn btn-danger" onclick="atualizarKycStatus(${idLiteral}, 'REPROVADO')">🚫 Reprovar</button>
              <button class="btn btn-secondary" onclick="atualizarKycStatus(${idLiteral}, 'PENDENTE')">↩️ Pendente</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
    lista.innerHTML = cards;
    if (empty) empty.style.display = 'none';
  };

  const listarKyc = async () => {
    const listaExiste = el('kycLista');
    if (!listaExiste || !isAdminUser()) {
      state.kycRegistros = [];
      renderKycLista();
      return;
    }
    const filtro = el('kycStatusFiltro')?.value || '';
    const query = filtro ? `?status=${encodeURIComponent(filtro)}` : '';
    try {
      const data = await apiRequest(`/kyc/comerciais${query}`);
      state.kycRegistros = Array.isArray(data) ? data : [];
    } catch (error) {
      notifyError('Erro ao carregar registros de KYC', error);
    }
    renderKycLista();
  };

  const atualizarKycStatus = async (id, novoStatus) => {
    if (!isAdminUser()) {
      alert('Apenas administradores podem atualizar o KYC.');
      return;
    }
    const obsEl = el(`kycObs-${id}`);
    const observacao = obsEl?.value || '';
    if (novoStatus === 'REPROVADO' && !observacao.trim()) {
      alert('Informe uma observação para reprovar o KYC.');
      return;
    }
    try {
      await apiRequest(`/kyc/comerciais/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: novoStatus, observacao })
      });
      alert('Status de KYC atualizado com sucesso!');
      await listarKyc();
    } catch (error) {
      notifyError('Erro ao atualizar status de KYC', error);
    }
  };

  const carregarDados = async () => {
    const tarefas = [
      fetchServicos(),
      fetchClientes(),
      fetchComerciais(),
      fetchCotacoes()
    ];
    if (isAdminUser()) {
      tarefas.push(listarKyc());
    } else {
      state.kycRegistros = [];
      renderKycLista();
    }
    await Promise.all(tarefas);
    if (temInvoiceUI()) {
      prepararEstadoInvoice();
      renderInvoiceForm();
      renderInvoiceItens();
      calcularInvoiceResumo();
    }
  };

  const restaurarSessao = async () => {
    if (!state.token) {
      hideApp();
      return;
    }
    try {
      const data = await apiRequest('/me');
      if (data?.user) {
        saveSession(state.token, data.user);
        resetarInvoice();
        await carregarDados();
        showApp();
        iniciarAtualizacaoTicker();
        return;
      }
    } catch (error) {
      console.warn('Sessão inválida', error);
    }
    clearSession();
    hideApp();
  };

  const prepararLogin = async () => {
    const user = el('loginUser')?.value.trim();
    const pass = el('loginPass')?.value;
    if (!user || !pass) {
      alert('Informe usuário e senha.');
      return;
    }
    try {
      const data = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: user, password: pass })
      });
      saveSession(data.token, data.user);
      resetarInvoice();
      await carregarDados();
      showApp();
      iniciarAtualizacaoTicker();
    } catch (error) {
      notifyError('Falha no login', error);
    }
  };

  const fazerLogout = async () => {
    if (!confirm('Deseja realmente sair?')) return;
    clearSession();
    hideApp();
    setValue('loginUser', '');
    setValue('loginPass', '');
  };

  const switchTab = (tabName, triggerEl) => {
    if (!podeAcessarTab(tabName)) {
      alert('Você não possui permissão para acessar esta área.');
      return;
    }
    document.querySelectorAll('[data-tab]').forEach(btn => btn.classList.remove('active'));
    if (triggerEl) {
      triggerEl.classList.add('active');
    } else {
      const btn = document.querySelector(`[data-tab="${tabName}"]`);
      if (btn) btn.classList.add('active');
    }
    document.querySelectorAll('.tab-content').forEach(section => section.classList.remove('active'));
    const section = el(tabName);
    if (section) section.classList.add('active');
    if (tabName === 'kyc' && isAdminUser()) {
      listarKyc();
    }
    if (tabName === 'invoice') {
      renderInvoiceForm();
      renderInvoiceItens();
      calcularInvoiceResumo();
      fetchInvoiceHistorico();
      setInvoiceStatus('');
    }
    if (tabName === 'invoice-historico') {
      fetchInvoiceHistorico();
      renderInvoiceHistorico();
    }
  };

  const salvarServico = async () => {
    const nome = el('adminNomeServico')?.value.trim();
    const tipoCusto = el('adminTipoCusto')?.value || 'fixo';
    const valor = toNumber(el('adminCustoServico')?.value);
    const status = el('adminStatusServico')?.value || 'ativo';
    if (!nome) {
      alert('Informe o nome do serviço.');
      return;
    }
    try {
      const payload = { nome, tipoCusto, valor, status };
      if (state.servicoEditando) {
        await apiRequest(`/servicos/${state.servicoEditando}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await apiRequest('/servicos', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      state.servicoEditando = null;
      limparFormAdmin();
      await fetchServicos();
      await fetchCotacoes();
      alert('Serviço salvo com sucesso!');
    } catch (error) {
      notifyError('Erro ao salvar serviço', error);
    }
  };

  const editarServico = id => {
    const servico = state.servicos.find(s => s.id === id);
    if (!servico) return;
    state.servicoEditando = id;
    setValue('adminNomeServico', servico.nome);
    setValue('adminTipoCusto', servico.tipoCusto);
    setValue('adminCustoServico', servico.valor);
    setValue('adminStatusServico', servico.status);
  };

  const excluirServico = async id => {
    if (!confirm('Deseja excluir este serviço?')) return;
    try {
      await apiRequest(`/servicos/${id}`, { method: 'DELETE' });
      await fetchServicos();
      await fetchCotacoes();
      alert('Serviço excluído com sucesso!');
    } catch (error) {
      notifyError('Erro ao excluir serviço', error);
    }
  };

  const limparFormAdmin = () => {
    setValue('adminNomeServico', '');
    setValue('adminTipoCusto', 'fixo');
    setValue('adminCustoServico', '');
    setValue('adminStatusServico', 'ativo');
    state.servicoEditando = null;
  };

  const salvarCliente = async () => {
    const nome = el('clienteNome')?.value.trim();
    const documento = el('clienteDoc')?.value.trim();
    const email = el('clienteEmail')?.value.trim();
    const telefone = el('clienteTelefone')?.value.trim();
    const endereco = el('clienteEndereco')?.value.trim();
    const observacoes = el('clienteObs')?.value.trim();
    if (!nome || !documento || !telefone) {
      alert('Preencha os campos obrigatórios do cliente.');
      return;
    }
    const payload = { nome, documento, email, telefone, endereco, observacoes };
    try {
      if (state.clienteEditando) {
        await apiRequest(`/clientes/${state.clienteEditando}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await apiRequest('/clientes', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      state.clienteEditando = null;
      limparFormCliente();
      await fetchClientes();
      await fetchCotacoes();
      alert('Cliente salvo com sucesso!');
    } catch (error) {
      notifyError('Erro ao salvar cliente', error);
    }
  };

  const editarCliente = id => {
    const cliente = state.clientes.find(c => c.id === id);
    if (!cliente) return;
    state.clienteEditando = id;
    setValue('clienteNome', cliente.nome);
    setValue('clienteDoc', cliente.documento);
    setValue('clienteEmail', cliente.email || '');
    setValue('clienteTelefone', cliente.telefone || '');
    setValue('clienteEndereco', cliente.endereco || '');
    setValue('clienteObs', cliente.observacoes || '');
    switchTab('clientes');
  };

  const excluirCliente = async id => {
    if (!confirm('Deseja excluir este cliente?')) return;
    try {
      await apiRequest(`/clientes/${id}`, { method: 'DELETE' });
      await fetchClientes();
      await fetchCotacoes();
      alert('Cliente excluído com sucesso!');
    } catch (error) {
      if (
        typeof error?.message === 'string' &&
        error.message.includes('Não é possível excluir este cliente porque existem cotações vinculadas a ele')
      ) {
        alert(
          'Não é possível excluir este cliente porque existem cotações vinculadas a ele.\n' +
            'Exclua ou reatribua as cotações vinculadas antes de tentar novamente.'
        );
      } else {
        notifyError('Erro ao excluir cliente', error);
      }
    }
  };

  const verHistoricoCliente = id => {
    const cliente = state.clientes.find(c => c.id === id);
    if (!cliente) return;
    const historico = getCotacoesVisiveis().filter(c => c.clienteId === id);
    let mensagem = `HISTÓRICO DO CLIENTE: ${cliente.nome}\n\n`;
    mensagem += `Total de Cotações: ${historico.length}\n`;
    const mapaTotal = {};
    historico.forEach(cot => {
      const mapaCotacao = calcularMapaCotacaoPorCampo(cot, 'valorVenda');
      mesclarMapaMoedas(mapaTotal, mapaCotacao);
    });
    mensagem += `Total Movimentado: ${formatMapaMoedas(mapaTotal)}\n\n`;
    historico.forEach(cot => {
      const status = cot.status === 'fechada' ? 'Fechada' : cot.status === 'analise' ? 'Em Análise' : 'Aguardando';
      mensagem += `${formatDate(cot.createdAt)} - ${formatarServicosCotacaoTexto(cot)} - ${status}\n`;
    });
    alert(mensagem);
  };

  const limparFormCliente = () => {
    setValue('clienteNome', '');
    setValue('clienteDoc', '');
    setValue('clienteEmail', '');
    setValue('clienteTelefone', '');
    setValue('clienteEndereco', '');
    setValue('clienteObs', '');
    state.clienteEditando = null;
  };

  const salvarComercial = async () => {
    if (!isAdminUser()) {
      alert('Apenas administradores podem gerenciar comerciais.');
      return;
    }
    const nome = el('comercialNome')?.value.trim();
    const cpf = el('comercialCPF')?.value.trim();
    const pix = el('comercialPix')?.value.trim();
    const status = el('comercialStatus')?.value || 'ativo';
    const senha = el('comercialSenha')?.value;
    const docFile = el('comercialDoc')?.files?.[0];
    const selfieFile = el('comercialSelfie')?.files?.[0];
    if (!nome || !cpf || !pix || (!state.comercialEditando && !senha)) {
      alert('Preencha todos os campos obrigatórios do comercial.');
      return;
    }
    const payload = {
      nome,
      cpf,
      pix,
      status,
      permissoes: getPermissoesFromForm()
    };
    if (senha) {
      payload.senha = senha;
    }
    if (docFile) {
      payload.documentoUrl = await fileToBase64(docFile);
    }
    if (selfieFile) {
      payload.selfieUrl = await fileToBase64(selfieFile);
    }
    try {
      if (state.comercialEditando) {
        await apiRequest(`/comerciais/${state.comercialEditando}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        if (!docFile || !selfieFile) {
          alert('Documento e selfie são obrigatórios para novo cadastro.');
          return;
        }
        await apiRequest('/comerciais', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      state.comercialEditando = null;
      limparFormComercial();
      await fetchComerciais();
      await fetchCotacoes();
      alert('Comercial salvo com sucesso!');
    } catch (error) {
      notifyError('Erro ao salvar comercial', error);
    }
  };

  const editarComercial = id => {
    const comercial = state.comerciais.find(c => c.id === id);
    if (!comercial) return;
    state.comercialEditando = id;
    setValue('comercialNome', comercial.nome);
    setValue('comercialCPF', comercial.cpf);
    setValue('comercialPix', comercial.pix);
    setValue('comercialStatus', comercial.status);
    setValue('comercialSenha', '');
    if (permissoesFormDisponivel()) {
      preencherPermissoesForm(comercial.permissoes);
    }
    ['comercialDoc', 'comercialSelfie'].forEach(idInput => {
      const input = el(idInput);
      if (input) input.value = '';
    });
    const previewDoc = el('previewDoc');
    const previewDocInfo = el('previewDocInfo');
    const previewSelfie = el('previewSelfie');
    if (previewDoc) previewDoc.style.display = 'none';
    if (previewDocInfo) {
      previewDocInfo.style.display = 'none';
      previewDocInfo.textContent = '';
    }
    if (previewSelfie) previewSelfie.style.display = 'none';
    switchTab('comerciais');
  };

  const excluirComercial = async id => {
    if (!confirm('Deseja excluir este comercial?')) return;
    try {
      await apiRequest(`/comerciais/${id}`, { method: 'DELETE' });
      await fetchComerciais();
      alert('Comercial excluído com sucesso!');
    } catch (error) {
      notifyError('Erro ao excluir comercial', error);
    }
  };

  const limparFormComercial = () => {
    setValue('comercialNome', '');
    setValue('comercialCPF', '');
    setValue('comercialPix', '');
    setValue('comercialStatus', 'ativo');
    setValue('comercialSenha', '');
    if (permissoesFormDisponivel()) {
      preencherPermissoesForm(getDefaultPermissoes());
    }
    const docInput = el('comercialDoc');
    const selfieInput = el('comercialSelfie');
    if (docInput) docInput.value = '';
    if (selfieInput) selfieInput.value = '';
    const previewDoc = el('previewDoc');
    const previewDocInfo = el('previewDocInfo');
    const previewSelfie = el('previewSelfie');
    if (previewDoc) previewDoc.style.display = 'none';
    if (previewDocInfo) {
      previewDocInfo.style.display = 'none';
      previewDocInfo.textContent = '';
    }
    if (previewSelfie) previewSelfie.style.display = 'none';
    state.comercialEditando = null;
  };

  const normalizarNomeServico = (servico) => {
    if (!servico?.nome) return '';
    return servico.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  };

  const servicoUsdtBras = servico => {
    const nome = normalizarNomeServico(servico);
    return nome.includes('usdt') && (nome.includes('bras') || nome.includes('brasil') || nome.includes('brás'));
  };

  const obterTaxaUsdtBrlComSpread = () => {
    const base = Number(state.ticker?.usdtBrl);
    if (!Number.isFinite(base)) return null;
    return base * (1 + USDT_SPREAD_PCT);
  };

  const atualizarResumoCambio = alvo => {
    const desktopWrapper = document.querySelector('[data-cambio-wrapper]');
    const desktopValor = document.querySelector('[data-cambio-value]');
    const mobileWrapper = el('cotacaoCambioWrapperMobile');
    const mobileValor = el('resultUsdtBrlMobile');

    const targets = [
      { wrapper: desktopWrapper, value: desktopValor },
      { wrapper: mobileWrapper, value: mobileValor }
    ];

    const deveExibir = typeof alvo === 'boolean'
      ? alvo
      : (alvo ? servicoUsdtBras(alvo) : false);
    const valorBase = Number.isFinite(Number(state.cotacaoUsdtBrl))
      ? Number(state.cotacaoUsdtBrl)
      : Number(state.ticker?.usdtBrl);
    const textoValor = Number.isFinite(valorBase)
      ? `${formatCurrency(valorBase)}${Number.isFinite(Number(state.cotacaoUsdtBrl)) ? ' (c/ spread)' : ''}`
      : '--';

    targets.forEach(target => {
      if (!target.wrapper || !target.value) return;
      if (!deveExibir) {
        target.wrapper.style.display = 'none';
        target.value.textContent = '--';
        return;
      }
      target.value.textContent = textoValor;
      target.wrapper.style.display = 'flex';
    });
  };

  const calcularCotacao = () => {
    if (temCotacaoMultiUI()) {
      calcularCotacaoMulti();
      return;
    }
    const servicoId = el('cotacaoServico')?.value;
    const valorVenda = toNumber(el('valorVenda')?.value);
    const comissaoPercent = toNumber(el('comissao')?.value);
    const moedaBase = normalizarMoedaLocal((el('cotacaoMoeda')?.value || state.cotacaoMoeda || 'BRL'));
    if (!servicoId) {
      setValue('custoDisplay', 'Selecione um serviço');
      setText('resultCusto', formatCurrencyByMoeda(0, moedaBase));
      setText('resultVenda', formatCurrencyByMoeda(valorVenda, moedaBase));
      setText('resultMargem', formatCurrencyByMoeda(0, moedaBase));
      setText('resultComissao', formatCurrencyByMoeda(0, moedaBase));
      setText('resultComissaoPercent', '0%');
      setText('resultFinal', formatCurrencyByMoeda(valorVenda, moedaBase));
      atualizarResumoCambio(null);
      return;
    }
    const servico = state.servicos.find(s => s.id === servicoId);
    if (!servico) return;
    const custo = servico.tipoCusto === 'percentual'
      ? valorVenda * (servico.valor / 100)
      : servico.valor;
    const deveConverterUsdt = servicoUsdtBras(servico) && moedaBase === 'USDT';
    const taxaUsdtSpread = deveConverterUsdt ? obterTaxaUsdtBrlComSpread() : null;
    if (deveConverterUsdt && !Number.isFinite(taxaUsdtSpread)) {
      setText('resultCusto', '--');
      setText('resultVenda', '--');
      setText('resultMargem', '--');
      setText('resultComissao', '--');
      setText('resultComissaoPercent', `${comissaoPercent.toFixed(1)}%`);
      setText('resultFinal', 'Cotação USDT/BRL indisponível');
      state.cotacaoUsdtBrl = null;
      atualizarResumoCambio(true);
      return;
    }

    const fatorConversao = taxaUsdtSpread || 1;
    const moedaDisplay = taxaUsdtSpread ? 'BRL' : moedaBase;
    const custoCalc = custo * fatorConversao;
    const vendaCalc = valorVenda * fatorConversao;
    const margem = vendaCalc - custoCalc;
    const comissao = vendaCalc * (comissaoPercent / 100);
    setValue('custoDisplay', servico.tipoCusto === 'percentual'
      ? `${servico.valor}% de ${formatCurrencyByMoeda(valorVenda, moedaBase)} = ${formatCurrencyByMoeda(custo, moedaBase)}`
      : formatCurrencyByMoeda(custo, moedaBase));
    setText('resultCusto', formatCurrencyByMoeda(custoCalc, moedaDisplay));
    setText('resultVenda', formatCurrencyByMoeda(vendaCalc, moedaDisplay));
    setText('resultMargem', formatCurrencyByMoeda(margem, moedaDisplay));
    setText('resultComissaoPercent', `${comissaoPercent.toFixed(1)}%`);
    setText('resultComissao', formatCurrencyByMoeda(comissao, moedaDisplay));
    setText('resultFinal', formatCurrencyByMoeda(vendaCalc, moedaDisplay));
    const deveExibirCambio = servicoUsdtBras(servico);
    if (deveExibirCambio && Number.isFinite(Number(taxaUsdtSpread || state.ticker?.usdtBrl))) {
      state.cotacaoUsdtBrl = taxaUsdtSpread || Number(state.ticker.usdtBrl);
    } else if (!deveExibirCambio) {
      state.cotacaoUsdtBrl = null;
    }
    atualizarResumoCambio(deveExibirCambio);
  };

  const calcularCotacaoMulti = () => {
    const resumoList = el('resumoItensList');
    const comissaoPercent = toNumber(el('comissao')?.value);
    const moedaEl = el('cotacaoMoeda');
    const moedaBase = normalizarMoedaLocal(moedaEl ? (moedaEl.value || 'BRL') : 'BRL');
    state.cotacaoMoeda = moedaBase;

    const itensDetalhados = state.cotacaoItens
      .map(item => {
        const servico = state.servicos.find(s => s.id === item.servicoId);
        const valorVenda = toNumber(item.valorVenda);
        if (!servico || valorVenda <= 0) return null;
        const custo = servico.tipoCusto === 'percentual'
          ? valorVenda * (servico.valor / 100)
          : servico.valor;
        return {
          uid: item.uid,
          servico,
          valorVenda,
          custo
        };
      })
      .filter(Boolean);

    const hasUsdtBras = itensDetalhados.some(item => servicoUsdtBras(item.servico));
    const deveConverterUsdt = hasUsdtBras && moedaBase === 'USDT';
    const taxaUsdtSpread = deveConverterUsdt ? obterTaxaUsdtBrlComSpread() : null;

    if (deveConverterUsdt && !Number.isFinite(taxaUsdtSpread)) {
      setText('resultCusto', '--');
      setText('resultVenda', '--');
      setText('resultMargem', '--');
      setText('resultComissaoPercent', `${comissaoPercent.toFixed(1)}%`);
      setText('resultComissao', '--');
      setText('resultFinal', 'Cotação USDT/BRL indisponível');
      state.cotacaoUsdtBrl = null;
      atualizarResumoCambio(true);
      return;
    }

    const itensConvertidos = itensDetalhados.map(item => {
      const isUsdtBras = servicoUsdtBras(item.servico);
      if (deveConverterUsdt && isUsdtBras && taxaUsdtSpread) {
        const valorBrl = item.valorVenda * taxaUsdtSpread;
        const custoBrl = item.custo * taxaUsdtSpread;
        return {
          ...item,
          valorDisplay: valorBrl,
          custoDisplay: custoBrl,
          margemDisplay: valorBrl - custoBrl,
          moedaDisplay: 'BRL'
        };
      }
      return {
        ...item,
        valorDisplay: item.valorVenda,
        custoDisplay: item.custo,
        margemDisplay: item.valorVenda - item.custo,
        moedaDisplay: moedaBase
      };
    });

    if (resumoList) {
      if (itensConvertidos.length === 0) {
        resumoList.innerHTML = '<li class="resumo-item">Adicione ao menos um serviço para visualizar o resumo.</li>';
      } else {
        resumoList.innerHTML = itensConvertidos.map((item, index) => `
          <li class="resumo-item">
            <div class="resumo-item__titulo">
              <span>${index + 1}. ${escapeHtml(item.servico.nome)}</span>
              <span>${formatCurrencyByMoeda(item.valorDisplay, item.moedaDisplay)}</span>
            </div>
            <div class="resumo-item__detalhes">
              <span>Custo: ${formatCurrencyByMoeda(item.custoDisplay, item.moedaDisplay)}</span>
              <span>Margem: ${formatCurrencyByMoeda(item.margemDisplay, item.moedaDisplay)}</span>
            </div>
          </li>
        `).join('');
      }
    }

    const totais = itensConvertidos.reduce((acc, item) => ({
      custo: acc.custo + item.custoDisplay,
      venda: acc.venda + item.valorDisplay,
      margem: acc.margem + item.margemDisplay
    }), { custo: 0, venda: 0, margem: 0 });

    const comissaoTotal = totais.venda * (comissaoPercent / 100);
    const moedaTotais = taxaUsdtSpread ? 'BRL' : moedaBase;
    setText('resultCusto', formatCurrencyByMoeda(totais.custo, moedaTotais));
    setText('resultVenda', formatCurrencyByMoeda(totais.venda, moedaTotais));
    setText('resultMargem', formatCurrencyByMoeda(totais.margem, moedaTotais));
    setText('resultComissaoPercent', `${comissaoPercent.toFixed(1)}%`);
    setText('resultComissao', formatCurrencyByMoeda(comissaoTotal, moedaTotais));
    setText('resultFinal', formatCurrencyByMoeda(totais.venda, moedaTotais));

    const deveExibirCambio = itensConvertidos.some(item => servicoUsdtBras(item.servico));
    if (deveExibirCambio && Number.isFinite(Number(taxaUsdtSpread || state.ticker?.usdtBrl))) {
      state.cotacaoUsdtBrl = taxaUsdtSpread || Number(state.ticker.usdtBrl);
    } else if (!deveExibirCambio) {
      state.cotacaoUsdtBrl = null;
    }
    atualizarResumoCambio(deveExibirCambio);
  };

  const salvarCotacao = async status => {
    const clienteId = el('cotacaoCliente')?.value;
    const comissaoPercent = toNumber(el('comissao')?.value);
    const observacoes = el('observacoes')?.value.trim();
    if (!clienteId) {
      alert('Selecione um cliente.');
      return;
    }
    let itens;
    try {
      itens = coletarItensCotacaoParaEnvio();
    } catch (error) {
      alert(error.message);
      return;
    }
    const payload = {
      clienteId,
      comissaoPercent,
      observacoes,
      status: status || 'analise',
      itens,
      moeda: obterMoedaDaCotacao(),
      cotacaoUsdtBrl: state.cotacaoUsdtBrl
    };
    try {
      await apiRequest('/cotacoes', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      await fetchCotacoes();
      limparFormCotacao();
      alert('Cotação registrada com sucesso!');
    } catch (error) {
      notifyError('Erro ao salvar cotação', error);
    }
  };

  const limparFormCotacao = () => {
    setValue('cotacaoCliente', '');
    setValue('observacoes', '');
    setValue('comissao', '');
    state.cotacaoUsdtBrl = null;
    if (temCotacaoMultiUI()) {
      const moedaSelect = el('cotacaoMoeda');
      if (moedaSelect) moedaSelect.value = 'BRL';
      state.cotacaoMoeda = 'BRL';
      resetarCotacaoItens();
      renderCotacaoItens();
    } else {
      setValue('cotacaoServico', '');
      setValue('custoDisplay', '');
      setValue('valorVenda', '');
    }
    calcularCotacao();
  };

  const mudarStatusCotacao = async (id, novoStatus) => {
    if (!isAdminUser()) {
      alert('Apenas administradores podem alterar o status das cotações.');
      return;
    }
    const cotacao = state.cotacoes.find(c => c.id === id);
    if (!cotacao || !podeGerenciarCotacao(cotacao)) {
      alert('Você não pode alterar esta cotação.');
      return;
    }
    try {
      await apiRequest(`/cotacoes/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: novoStatus })
      });
      await fetchCotacoes();
      alert('Status atualizado com sucesso!');
    } catch (error) {
      notifyError('Erro ao atualizar status', error);
    }
  };

  const excluirCotacao = async id => {
    const cotacao = state.cotacoes.find(c => c.id === id);
    if (!cotacao || !podeGerenciarCotacao(cotacao)) {
      alert('Você não pode excluir esta cotação.');
      return;
    }
    if (!confirm('Deseja excluir esta cotação?')) return;
    try {
      await apiRequest(`/cotacoes/${id}`, { method: 'DELETE' });
      await fetchCotacoes();
      alert('Cotação excluída com sucesso!');
    } catch (error) {
      notifyError('Erro ao excluir cotação', error);
    }
  };

  const filtrarCotacoesAbertas = () => {
    const busca = (el('filtroAbertoBusca')?.value || '').toLowerCase();
    const statusFiltro = el('filtroAbertoStatus')?.value;
    let abertas = getCotacoesVisiveis().filter(c => c.status === 'analise' || c.status === 'aguardando');
    if (busca) {
      abertas = abertas.filter(c => c.clienteNome?.toLowerCase().includes(busca));
    }
    if (statusFiltro) {
      abertas = abertas.filter(c => c.status === statusFiltro);
    }
    renderCotacoesAbertas(abertas);
  };

  const filtrarCotacoesFechadas = () => {
    const busca = (el('filtroFechadoBusca')?.value || '').toLowerCase();
    let fechadas = getCotacoesVisiveis().filter(c => c.status === 'fechada');
    if (busca) {
      fechadas = fechadas.filter(c => c.clienteNome?.toLowerCase().includes(busca));
    }
    renderCotacoesFechadas(fechadas);
  };

  const previewImage = (input, previewId) => {
    const preview = el(previewId);
    const info = el(`${previewId}Info`);
    if (!input?.files?.length) {
      if (preview) preview.style.display = 'none';
      if (info) info.style.display = 'none';
      return;
    }
    const file = input.files[0];
    const isImagem = file.type?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.name || '');
    if (isImagem) {
      const reader = new FileReader();
      reader.onload = e => {
        if (preview) {
          preview.src = e.target.result;
          preview.style.display = 'block';
        }
        if (info) info.style.display = 'none';
      };
      reader.readAsDataURL(file);
    } else {
      if (preview) preview.style.display = 'none';
      if (info) {
        info.textContent = `Arquivo anexado: ${file.name || file.type || 'documento'}`;
        info.style.display = 'block';
      }
    }
  };

  const formatCpfInput = event => {
    let value = event.target.value.replace(/\D/g, '');
    if (value.length > 11) value = value.slice(0, 11);
    if (value.length > 9) {
      value = value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    } else if (value.length > 6) {
      value = value.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
    } else if (value.length > 3) {
      value = value.replace(/(\d{3})(\d{1,3})/, '$1.$2');
    }
    event.target.value = value;
  };

  const exported = {
    fazerLogin: prepararLogin,
    fazerLogout,
    switchTab,
    salvarServico,
    editarServico,
    excluirServico,
    limparFormAdmin,
    salvarCliente,
    editarCliente,
    excluirCliente,
    verHistoricoCliente,
    limparFormCliente,
    salvarComercial,
    editarComercial,
    excluirComercial,
    limparFormComercial,
    previewImage,
    adicionarItemCotacao,
    removerItemCotacao,
    atualizarItemCotacaoCampo,
    calcularCotacao,
    salvarCotacao,
    limparFormCotacao,
    mudarStatusCotacao,
    excluirCotacao,
    filtrarCotacoesAbertas,
    filtrarCotacoesFechadas,
    listarKyc,
    atualizarKycStatus,
    abrirKycDocumentos,
    fecharKycDocumentos,
    preencherDadosClienteInvoice,
    atualizarInvoiceCampo,
    adicionarInvoiceItem,
    removerInvoiceItem,
    atualizarInvoiceItemCampo,
    limparInvoiceForm,
    gerarInvoice,
    fetchInvoiceHistorico,
    baixarInvoicePdf,
    deletarInvoice
  };

  Object.assign(window, exported);

  const cpfInput = el('comercialCPF');
  if (cpfInput) {
    cpfInput.addEventListener('input', formatCpfInput);
  }

  definirPermissoesPadraoForm();
  calcularCotacao();
  renderInvoiceForm();
  renderInvoiceItens();
  calcularInvoiceResumo();
  setInvoiceStatus('');
  restaurarSessao();
  iniciarAtualizacaoTicker();
})();
