# 🚀 Sistema de Simulação Zenith Pay - Produção

Guia oficial de publicação das versões desktop e mobile do Sistema de Simulação Zenith Pay.

> Origem dos arquivos: `C:\Users\rbast\Downloads\sistema-zenith-producao-final`. Use este diretório local como referência caso precise reenviar o pacote manualmente. O bundle antigo (`sistema-investimentos-zenith-final`) não deve mais ser utilizado.

---

## 📂 Arquivos do Pacote

| Arquivo | Descrição |
| --- | --- |
| `sistema_de_simulacao_zenith.html` | Versão desktop / painel completo.
| `sistema_de_simulacao_zenith_mobile.html` | Versão mobile independente (tabs, navegação inferior).
| `app.js` | Lógica front-end compartilhada (login, requisições, permissões).
| `server.js` | API Express (JWT + CRUDs) e servidor estático.
| `prisma/` | Schema, migrations e seed (`prisma/seed.js`).
| `package.json` | Scripts (`npm start`, `npm run db:migrate`, `npm run db:seed`).
| `.env.example` | Modelo de variáveis (`DATABASE_URL`, `JWT_SECRET`, `ADMIN_USER`, `ADMIN_PASS`).
| `README.md` | Resumo rápido de uso.
| `zenith-logo.png` | Logo oficial em alta resolução.

---

## ☁️ Deploy recomendado (Railway)

1. **Pré-requisitos**
   - Node.js 18+ instalado localmente.
   - [Railway CLI](https://docs.railway.app/develop/cli) configurado.

2. **Inicializar o serviço**
   ```bash
   railway login
   railway init            # "Deploy from Source"
   ```

3. **Adicionar banco PostgreSQL**
   - No painel do Railway (ou via `railway add`), crie um recurso **PostgreSQL**.
   - Copie a `DATABASE_URL` fornecida.

4. **Variáveis obrigatórias no serviço web**
   - `DATABASE_URL` – string completa do banco criado.
   - `JWT_SECRET` – chave forte para assinar tokens.
   - `ADMIN_USER` e `ADMIN_PASS` – credenciais do administrador master.
   - (Opcional) `PORT` caso deseje porta fixa diferente de 3000.

5. **Primeiro deploy + migrations**
   ```bash
   railway up                      # envia o código e executa o build (npm install + npm start)
   railway run npm run db:migrate  # aplica migrations no PostgreSQL do Railway
   railway run npm run db:seed     # popula com serviços/clientes/cotações demo (opcional)
   ```

6. **Comportamento da aplicação**
   - `/` → painel desktop
   - `/mobile` → versão mobile
   - Endpoints REST (`/auth`, `/servicos`, `/clientes`, `/cotacoes`, `/comerciais`) servem a UI.
   - Railway provê HTTPS automático; vincule um domínio customizado se necessário.

7. **Operação contínua**
   - Use `railway run npm run db:migrate` sempre que o schema Prisma mudar.
   - `railway status` / painel para acompanhar logs e reiniciar serviços.
   - `railway up` dispara novos builds a partir da branch principal.

---

## 🌐 Deploy alternativo (VPS, Docker ou cPanel com Node)

1. **Servidor** – garanta Node.js 18+, acesso ao PostgreSQL (pode ser RDS/Azure/etc.) e HTTPS via Nginx/Apache.
2. **Código** – clone o repositório, copie `.env.example` para `.env` e informe as variáveis do banco/segurança.
3. **Dependências** – rode `npm install`, `npm run db:generate`, depois `npm run db:migrate` e `npm run db:seed` (opcional).
4. **Processo** – utilize um gerenciador como `pm2` ou `systemd` para manter `npm start` ativo. Exemplos:
   ```bash
   pm2 start "npm start" --name zenith
   pm2 save
   ```
5. **Proxy/SSL** – exponha `PORT` via Nginx/Apache apontando para `http://127.0.0.1:PORT`, ativando HTTPS conforme política do servidor.
6. **Atualizações** – ao publicar nova versão, execute novamente `npm run db:migrate` (se houver alterações de schema) e reinicie o processo Node.

---

## 🔐 Credenciais e segurança

- Defina o par `ADMIN_USER` / `ADMIN_PASS` diretamente nas variáveis de ambiente (não há mais credencial fixa no código).
- Comerciais utilizam CPF/chave PIX + senha configurada pelo administrador (hash armazenado no banco).
- Use obrigatoriamente HTTPS (Railway já entrega SSL; domínios próprios precisam de DNS apontado).
- Recomendações adicionais:
  1. Limite tentativas de login (rate limiting) caso exponha publicamente.
  2. Monitore acessos e erros via logs do Railway.
  3. Configure backups automáticos/snapshots do PostgreSQL.

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

- Orquestrar workers para envio automático de relatórios (PDF/Excel) e notificações.
- Guardar anexos (documento/selfie) em storage dedicado (S3/Cloudflare R2) em vez de base64 no banco.
- Implementar MFA/bloqueio de tentativas no login administrador.
- Evoluir para aplicativo mobile nativo (React Native) reutilizando a API atual.

---

**Dúvidas?** suporte@zenithpay.com.br │ WhatsApp corporativo.
