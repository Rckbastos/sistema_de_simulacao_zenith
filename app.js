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
    kyc: 'adminMaster'
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
    servicoEditando: null,
    clienteEditando: null,
    comercialEditando: null,
    kycRegistros: [],
    cotacaoItens: [],
    cotacaoMoeda: 'BRL',
    cotacaoUsdtBrl: null
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
    return moeda === 'USD'
      ? currencyFormatterUSD.format(numero)
      : currencyFormatter.format(numero);
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

  const jsStringLiteral = value => `'${String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')}'`;

  const tickerFormatter = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
  });
  const TICKER_REFRESH_MS = 60000;
  let tickerTimer = null;
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
  const temCotacaoMultiUI = () => Boolean(el('cotacaoItensContainer'));

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
      renderTicker(data);
      if (temCotacaoMultiUI() || el('cotacaoServico')) {
        calcularCotacao();
      } else {
        atualizarResumoCambio(false);
      }
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
    if (STORAGE_OK) {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(USER_KEY);
    }
  };

  const apiRequest = async (path, options = {}) => {
    const config = { ...options };
    config.headers = new Headers(options.headers || {});
    if (state.token) {
      config.headers.set('Authorization', `Bearer ${state.token}`);
    }
    if (config.body && !(config.body instanceof FormData) && !config.headers.has('Content-Type')) {
      config.headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(path, config);
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
      notifyError('Erro ao excluir cliente', error);
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

  const servicoUsdtPix = servico => {
    if (!servico?.nome) return false;
    const nome = servico.nome.toLowerCase();
    return nome.includes('usdt') && nome.includes('pix');
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
      : (alvo ? servicoUsdtPix(alvo) : false);
    const valor = Number(state.ticker?.usdtBrl);
    const textoValor = Number.isFinite(valor) ? formatCurrency(valor) : '--';

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
    if (!servicoId) {
      setValue('custoDisplay', 'Selecione um serviço');
      setText('resultCusto', formatCurrency(0));
      setText('resultVenda', formatCurrency(valorVenda));
      setText('resultMargem', formatCurrency(0));
      setText('resultComissao', formatCurrency(0));
      setText('resultComissaoPercent', '0%');
      setText('resultFinal', formatCurrency(valorVenda));
      atualizarResumoCambio(null);
      return;
    }
    const servico = state.servicos.find(s => s.id === servicoId);
    if (!servico) return;
    const custo = servico.tipoCusto === 'percentual'
      ? valorVenda * (servico.valor / 100)
      : servico.valor;
    const margem = valorVenda - custo;
    const comissao = valorVenda * (comissaoPercent / 100);
    setValue('custoDisplay', servico.tipoCusto === 'percentual'
      ? `${servico.valor}% de ${formatCurrency(valorVenda)} = ${formatCurrency(custo)}`
      : formatCurrency(custo));
    setText('resultCusto', formatCurrency(custo));
    setText('resultVenda', formatCurrency(valorVenda));
    setText('resultMargem', formatCurrency(margem));
    setText('resultComissaoPercent', `${comissaoPercent.toFixed(1)}%`);
    setText('resultComissao', formatCurrency(comissao));
    setText('resultFinal', formatCurrency(valorVenda));
    const deveExibirCambio = servicoUsdtPix(servico);
    if (deveExibirCambio && Number.isFinite(Number(state.ticker?.usdtBrl))) {
      state.cotacaoUsdtBrl = Number(state.ticker.usdtBrl);
    } else if (!deveExibirCambio) {
      state.cotacaoUsdtBrl = null;
    }
    atualizarResumoCambio(deveExibirCambio);
  };

  const calcularCotacaoMulti = () => {
    const resumoList = el('resumoItensList');
    const comissaoPercent = toNumber(el('comissao')?.value);
    const moedaEl = el('cotacaoMoeda');
    const moeda = moedaEl ? (moedaEl.value || 'BRL') : 'BRL';
    state.cotacaoMoeda = moeda;

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
          custo,
          margem: valorVenda - custo,
          comissao: valorVenda * (comissaoPercent / 100)
        };
      })
      .filter(Boolean);

    if (resumoList) {
      if (itensDetalhados.length === 0) {
        resumoList.innerHTML = '<li class="resumo-item">Adicione ao menos um serviço para visualizar o resumo.</li>';
      } else {
        resumoList.innerHTML = itensDetalhados.map((item, index) => `
          <li class="resumo-item">
            <div class="resumo-item__titulo">
              <span>${index + 1}. ${escapeHtml(item.servico.nome)}</span>
              <span>${formatCurrencyByMoeda(item.valorVenda, moeda)}</span>
            </div>
            <div class="resumo-item__detalhes">
              <span>Custo: ${formatCurrencyByMoeda(item.custo, moeda)}</span>
              <span>Margem: ${formatCurrencyByMoeda(item.margem, moeda)}</span>
            </div>
          </li>
        `).join('');
      }
    }

    const totais = itensDetalhados.reduce((acc, item) => ({
      custo: acc.custo + item.custo,
      venda: acc.venda + item.valorVenda,
      margem: acc.margem + item.margem
    }), { custo: 0, venda: 0, margem: 0 });

    const comissaoTotal = totais.venda * (comissaoPercent / 100);
    setText('resultCusto', formatCurrencyByMoeda(totais.custo, moeda));
    setText('resultVenda', formatCurrencyByMoeda(totais.venda, moeda));
    setText('resultMargem', formatCurrencyByMoeda(totais.margem, moeda));
    setText('resultComissaoPercent', `${comissaoPercent.toFixed(1)}%`);
    setText('resultComissao', formatCurrencyByMoeda(comissaoTotal, moeda));
    setText('resultFinal', formatCurrencyByMoeda(totais.venda, moeda));

    const deveExibirCambio = itensDetalhados.some(item => servicoUsdtPix(item.servico));
    if (deveExibirCambio && Number.isFinite(Number(state.ticker?.usdtBrl))) {
      state.cotacaoUsdtBrl = Number(state.ticker.usdtBrl);
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
    fecharKycDocumentos
  };

  Object.assign(window, exported);

  const cpfInput = el('comercialCPF');
  if (cpfInput) {
    cpfInput.addEventListener('input', formatCpfInput);
  }

  definirPermissoesPadraoForm();
  calcularCotacao();
  restaurarSessao();
  iniciarAtualizacaoTicker();
})();
