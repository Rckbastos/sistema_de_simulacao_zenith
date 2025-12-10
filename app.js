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
    admin: 'adminServicos'
  };

  const currencyFormatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });

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
    servicoEditando: null,
    clienteEditando: null,
    comercialEditando: null
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

  const showApp = () => {
    const loginScreen = el('loginScreen');
    const appContainer = el('appContainer');
    if (loginScreen && appContainer) {
      loginScreen.style.display = 'none';
      appContainer.classList.add('active');
    }
    updateUserHeader();
    aplicarPermissoesNasTabs();
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
      const totalMov = cotacoesVisiveis
        .filter(c => c.clienteId === cliente.id && c.status === 'fechada')
        .reduce((sum, cot) => sum + cot.valorVenda, 0);
      const cotacoesCliente = cotacoesVisiveis.filter(c => c.clienteId === cliente.id).length;
      const idLiteral = jsStringLiteral(cliente.id);
      tabela.innerHTML += `
        <tr>
          <td><strong>${escapeHtml(cliente.nome)}</strong></td>
          <td>${escapeHtml(cliente.documento)}</td>
          <td>${escapeHtml(cliente.telefone || '')}</td>
          <td>${formatCurrency(totalMov)}</td>
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
    abertas.forEach(cot => {
      const statusLabel = cot.status === 'analise' ? 'Em Análise' : 'Aguardando Confirmação';
      const badgeClass = cot.status === 'analise' ? 'badge-warning' : 'badge-info';
      const idLiteral = jsStringLiteral(cot.id);
      tabela.innerHTML += `
        <tr>
          <td>${cot.createdAt ? formatDate(cot.createdAt) : '-'}</td>
          <td><strong>${escapeHtml(cot.clienteNome)}</strong></td>
          <td>${escapeHtml(cot.servicoNome)}</td>
          <td style="color: var(--accent-gold); font-weight: 700;">${formatCurrency(cot.valorVenda)}</td>
          <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
          <td>
            <button class="action-btn action-btn-edit" onclick="mudarStatusCotacao(${idLiteral}, 'fechada')">✓ Fechar</button>
            <button class="action-btn action-btn-delete" onclick="excluirCotacao(${idLiteral})">🗑️ Excluir</button>
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
          <td>${escapeHtml(cot.servicoNome)}</td>
          <td style="color: var(--accent-gold); font-weight: 700;">${formatCurrency(cot.valorVenda)}</td>
          <td style="color: var(--success); font-weight: 700;">${formatCurrency(cot.comissao)}</td>
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
    const valorTotal = base.filter(c => c.status === 'fechada').reduce((total, c) => total + c.valorVenda, 0);
    const clientesSet = new Set(base.map(c => c.clienteId));
    const totalClientesIndicador = isAdminUser() ? state.clientes.length : clientesSet.size;
    setText('totalAberto', abertas);
    setText('totalFechado', fechadas);
    setText('valorTotal', formatCurrency(valorTotal));
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

  const carregarDados = async () => {
    await Promise.all([
      fetchServicos(),
      fetchClientes(),
      fetchComerciais(),
      fetchCotacoes()
    ]);
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
    const total = historico.reduce((sum, cot) => sum + cot.valorVenda, 0);
    mensagem += `Total Movimentado: ${formatCurrency(total)}\n\n`;
    historico.forEach(cot => {
      const status = cot.status === 'fechada' ? 'Fechada' : cot.status === 'analise' ? 'Em Análise' : 'Aguardando';
      mensagem += `${formatDate(cot.createdAt)} - ${cot.servicoNome} - ${status}\n`;
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
    const previewSelfie = el('previewSelfie');
    if (previewDoc) previewDoc.style.display = 'none';
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
    const previewSelfie = el('previewSelfie');
    if (previewDoc) previewDoc.style.display = 'none';
    if (previewSelfie) previewSelfie.style.display = 'none';
    state.comercialEditando = null;
  };

  const calcularCotacao = () => {
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
  };

  const salvarCotacao = async status => {
    const clienteId = el('cotacaoCliente')?.value;
    const servicoId = el('cotacaoServico')?.value;
    const valorVenda = toNumber(el('valorVenda')?.value);
    const comissaoPercent = toNumber(el('comissao')?.value);
    const observacoes = el('observacoes')?.value.trim();
    if (!clienteId || !servicoId || !valorVenda) {
      alert('Preencha cliente, serviço e valor de venda.');
      return;
    }
    const servico = state.servicos.find(s => s.id === servicoId);
    if (!servico) {
      alert('Serviço inválido.');
      return;
    }
    const custo = servico.tipoCusto === 'percentual'
      ? valorVenda * (servico.valor / 100)
      : servico.valor;
    const margem = valorVenda - custo;
    const comissao = valorVenda * (comissaoPercent / 100);
    const payload = {
      clienteId,
      servicoId,
      valorVenda,
      custo,
      margem,
      comissaoPercent,
      comissao,
      observacoes,
      status: status || 'analise'
    };
    try {
      await apiRequest('/cotacoes', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      await fetchCotacoes();
      calcularCotacao();
      alert('Cotação registrada com sucesso!');
    } catch (error) {
      notifyError('Erro ao salvar cotação', error);
    }
  };

  const limparFormCotacao = () => {
    setValue('cotacaoCliente', '');
    setValue('cotacaoServico', '');
    setValue('custoDisplay', '');
    setValue('valorVenda', '');
    setValue('comissao', '');
    setValue('observacoes', '');
    calcularCotacao();
  };

  const mudarStatusCotacao = async (id, novoStatus) => {
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
    if (!input?.files?.length) return;
    const reader = new FileReader();
    reader.onload = e => {
      const preview = el(previewId);
      if (preview) {
        preview.src = e.target.result;
        preview.style.display = 'block';
      }
    };
    reader.readAsDataURL(input.files[0]);
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
    calcularCotacao,
    salvarCotacao,
    limparFormCotacao,
    mudarStatusCotacao,
    excluirCotacao,
    filtrarCotacoesAbertas,
    filtrarCotacoesFechadas
  };

  Object.assign(window, exported);

  const cpfInput = el('comercialCPF');
  if (cpfInput) {
    cpfInput.addEventListener('input', formatCpfInput);
  }

  definirPermissoesPadraoForm();
  calcularCotacao();
  restaurarSessao();
})();
