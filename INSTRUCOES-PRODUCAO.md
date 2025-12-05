# 🚀 Sistema de Simulação Zenith Pay - Produção

Guia oficial de publicação das versões desktop e mobile do Sistema de Simulação Zenith Pay.

> Origem dos arquivos: `C:\Users\rbast\Downloads\sistema-zenith-producao-final`. Use este diretório local como referência caso precise reenviar o pacote manualmente. O bundle antigo (`sistema-investimentos-zenith-final`) não deve mais ser utilizado.

---

## 📂 Arquivos do Pacote

| Arquivo | Descrição |
| --- | --- |
| `sistema_de_simulacao_zenith.html` | Versão desktop / painel completo.
| `sistema_de_simulacao_zenith_mobile.html` | Versão mobile independente (tabs, navegação inferior).
| `zenith-logo.png` | Logo oficial em alta resolução.
| `server.js` | Servidor HTTP simples em Node.js.
| `package.json` | Scripts (`npm start`) e metadados usados pelo Railway.
| `README.md` | Resumo rápido de uso.

---

## ☁️ Deploy recomendado (Railway)

1. **Pré-requisitos**
   - Node.js 18+ instalado localmente.
   - [Railway CLI](https://docs.railway.app/develop/cli) e conta ativa.

2. **Primeira configuração**
   ```bash
   railway login
   railway init        # "Deploy from Source"
   # selecione o diretório atual como raiz do projeto
   ```

3. **Deploy**
   ```bash
   railway up          # envia o código e dispara build
   ```

4. **Comportamento da aplicação**
   - Railway detecta o `package.json`, executa `npm install` e roda `npm start` (que chama `node server.js`).
   - Porta é fornecida pela variável `PORT` (já suportado pelo `server.js`).
   - Rotas disponíveis:
     - `/` → versão desktop (`sistema_de_simulacao_zenith.html`)
     - `/mobile` → versão mobile (`sistema_de_simulacao_zenith_mobile.html`)
     - `/zenith-logo.png` → logo compartilhada

5. **Pós-deploy**
   - Configure o domínio customizado no painel do Railway (opcional).
   - Ative HTTPS gratuito diretamente na plataforma.
   - Rode `railway status` para acompanhar builds futuros.

---

## 🌐 Deploy alternativo (Apache/Nginx ou cPanel)

1. Faça upload dos três arquivos estáticos (`*.html` + `zenith-logo.png`).
2. Opcional: renomeie `sistema_de_simulacao_zenith.html` → `index.html` e `sistema_de_simulacao_zenith_mobile.html` → `mobile.html`.
3. Estrutura sugerida:
   ```
   /var/www/html/zenith/
   ├── index.html
   ├── mobile.html
   └── zenith-logo.png
   ```
4. Permissões: `chmod 644 *.html *.png`.
5. URLs padrão: `https://seudominio.com/zenith/` (desktop) e `https://seudominio.com/zenith/mobile.html`.

> Preferindo cPanel, o fluxo é idêntico via Gerenciador de Arquivos (`public_html/zenith`).

---

## 🔐 Credenciais e segurança

- Login padrão (alterar antes do go-live): `admin / admin123`.
- Procure pelo trecho `password: 'admin123'` nos HTMLs para personalizar rapidamente.
- Use obrigatoriamente HTTPS (Let's Encrypt / Railway já provê SSL automático).
- Recomendações adicionais:
  1. Implementar autenticação real (backend, hash de senhas, proteção contra brute force).
  2. Habilitar firewall e monitorar tentativas de login.
  3. Configurar backups automáticos dos arquivos e, quando houver, do banco de dados.

---

## 📱 Mobile & redirecionamento

O servidor Node expõe `/mobile`. Para forçar o redirecionamento automático em dispositivos móveis, adicione próximo ao `<head>` do arquivo desktop:

```html
<script>
if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
  window.location.href = '/mobile';
}
</script>
```

---

## ✅ Checklist antes de publicar

- [ ] Logo carregando corretamente.
- [ ] Credenciais atualizadas.
- [ ] Testes executados em Chrome, Firefox, Safari e Edge.
- [ ] Testes executados em dispositivos iOS/Android reais.
- [ ] HTTPS ativo + certificado válido.
- [ ] Monitoramento configurado (Google Analytics, Uptime Robot, etc.).
- [ ] Backup dos arquivos efetuado.

---

## 🆘 Problemas comuns

1. **Logo invisível** – confirme se `zenith-logo.png` está no mesmo diretório e sem cache.
2. **Login não funciona** – verifique se o JavaScript está habilitado e utilize o console (F12) para logs.
3. **Layout mobile quebrado** – acesse `.../mobile` diretamente e limpe o cache do navegador.

---

## 📈 Próximas melhorias sugeridas

- API Node/Express com banco (PostgreSQL) para controle real de usuários.
- Exportação de relatórios (PDF/Excel) e envio automático.
- Notificações WhatsApp / push.
- App mobile nativo (React Native) com autenticação biométrica.

---

**Dúvidas?** suporte@zenithpay.com.br │ WhatsApp corporativo.
