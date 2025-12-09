# 🚀 Sistema de Simulação Zenith

Painel administrativo (desktop) e fluxo mobile do Sistema de Simulação Zenith Pay agora alimentados por um backend Node.js/Express com Prisma + PostgreSQL. Todos os cadastros (serviços, clientes, comerciais e cotações) ficam persistidos no banco — nada é mais salvo em `localStorage`.

> Atualização: a UI continua derivada do pacote `C:\Users\rbast\Downloads\sistema-zenith-producao-final`, porém toda a camada de dados passou a conversar com API própria (`server.js`). O deploy recomendado é via Railway com um banco PostgreSQL dedicado.

---

## 📂 Conteúdo do Repositório

- `sistema_de_simulacao_zenith.html` – versão desktop/responsiva (login + dashboards por perfil).
- `sistema_de_simulacao_zenith_mobile.html` – experiência mobile dedicada.
- `app.js` – camada única de front-end (consome a API, trata permissões e sincroniza tabelas em ambas as versões).
- `server.js` – API Express (JWT, CRUDs, upload base64 dos documentos, serve os arquivos estáticos).
- `prisma/` – schema, migrations e seed com dados de exemplo.
- `package.json` – scripts (`npm run dev`, `npm run db:migrate`, `npm run db:seed` etc.).
- `.env.example` – modelo de variáveis obrigatórias (copie para `.env`).
- `INSTRUCOES-PRODUCAO.md` – guia de deploy/operacional.
- `zenith-logo.png` – logo oficial usada nas telas.

---

## 🧱 Arquitetura

- **Backend:** Express + Prisma + PostgreSQL, autenticação baseada em JWT. Endpoints expõem `/auth/login`, `/servicos`, `/clientes`, `/comerciais` (admin) e `/cotacoes` com todas as regras de permissão.
- **Frontend:** único bundle (`app.js`) que alimenta as versões desktop e mobile, renderiza abas, filtros e aplica as permissões recebidas do token.
- **Banco:** migrations em `prisma/migrations` + seed (`npm run db:seed`) com serviços, um comercial demonstrativo e duas cotações de exemplo.

## 🧩 Funcionalidades Principais

- Login seguro: admin usa as credenciais definidas nas variáveis `ADMIN_USER`/`ADMIN_PASS`; comerciais entram via CPF/chave PIX + senha cadastrada no menu **Comerciais**.
- CRUDs de serviços, clientes, comerciais e cotações totalmente integrados ao banco PostgreSQL via API (edições refletem para todos os usuários/logins).
- Motor de permissões granular (Dashboard, Nova Cotação, Cotações em aberto/fechadas, Clientes, Comerciais, Admin-Serviços e flag Administrador) controlado por checkbox ao cadastrar comerciais.
- Simulador financeiro calcula custo/margem/comissão automaticamente e atualiza cards do dashboard em tempo real.
- Dashboards distintos: administradores enxergam todo o portfólio; comerciais visualizam apenas cotações e clientes vinculados ao seu usuário.
- Versão mobile com os mesmos recursos essenciais (cotação, filtros, cadastro de clientes e visão de serviços) servida em `/mobile`.

---

## 🧪 Execução Local

1. Tenha **Node.js 18+** e um PostgreSQL acessível (pode ser local ou a própria instância do Railway).
2. Copie o template de variáveis e configure credenciais reais:
   ```bash
   cp .env.example .env
   # edite DATABASE_URL, JWT_SECRET, ADMIN_USER e ADMIN_PASS
   ```
3. Instale as dependências e gere o client Prisma:
   ```bash
   npm install
   npm run db:generate
   ```
4. Aplique as migrations no banco escolhido e rode o seed com os dados demonstrativos:
   ```bash
   npm run db:migrate   # executa prisma migrate deploy
   npm run db:seed
   ```
5. Inicie o servidor (porta definida pela variável `PORT`, padrão 3000):
   ```bash
   npm run dev   # ou npm start
   ```
6. Acesse `http://localhost:3000` (desktop) ou `http://localhost:3000/mobile` (mobile).

**Credenciais:** o admin usa o par definido nas variáveis `ADMIN_USER`/`ADMIN_PASS`. Comerciais se autenticam com CPF/PIX + senha criada no cadastro. Todos os dados são persistidos no PostgreSQL.

---

## ☁️ Deploy com Railway (passo a passo)

1. **CLI & login** – instale o [Railway CLI](https://docs.railway.app/develop/cli), execute `railway login` e autorize.
2. **Inicialização do projeto** –rodar `railway init` dentro do repositório e selecionar _Deploy from Source_. Escolha `npm start` como comando padrão (é o que já está no `package.json`).
3. **Banco de dados** – crie um recurso PostgreSQL no painel do Railway (Add ➜ Database ➜ PostgreSQL). Copie a string completa e defina em `DATABASE_URL` no serviço web.
4. **Variáveis obrigatórias** – ainda no painel, adicione `JWT_SECRET`, `ADMIN_USER`, `ADMIN_PASS` (use valores fortes) e, se desejar, ajuste `PORT`.
5. **Aplicar migrations** – após o primeiro deploy, execute:
   ```bash
   railway run npm run db:migrate
   railway run npm run db:seed
   ```
   (esses comandos usam o mesmo banco provisionado pelo Railway.)
6. **Publicação contínua** – rode `railway up` para enviar novos commits. O build roda `npm install` e inicia `npm start` automaticamente; como as migrations já existem, basta repetir o passo 5 quando o schema mudar.
7. **Rotas finais** – `/` serve o painel desktop, `/mobile` mostra a versão mobile e todos os endpoints REST permanecem sob o mesmo host (útil para monitoramento).

---

## 📦 Alternativa: Deploy manual (VPS/Docker/cPanel com Node)

1. Provisiona um servidor com Node.js 18+, PostgreSQL (ou utilize um serviço gerenciado) e HTTPS via Nginx/Apache.
2. Clone o repositório, copie `.env.example` para `.env` e informe `DATABASE_URL`, `JWT_SECRET`, `ADMIN_USER` e `ADMIN_PASS`.
3. Rode `npm install`, `npm run db:generate`, `npm run db:migrate` e `npm run db:seed` (se precisar de dados demo).
4. Inicie o app com `npm start` usando `pm2`, `systemd` ou Docker. Proxie a porta configurada em `PORT`.
5. O guia detalhado (incluindo PM2 e boas práticas) está em `INSTRUCOES-PRODUCAO.md`.

---

## ✅ Checklist Rápido

- Variáveis de ambiente preenchidas (`DATABASE_URL`, `JWT_SECRET`, `ADMIN_USER`, `ADMIN_PASS`).
- Migrations aplicadas + seed executado no banco de produção.
- Logo carregando nas duas versões, inclusive via `/mobile`.
- Testes em navegadores desktop e dispositivos móveis reais.
- HTTPS ativo (Railway já entrega SSL, domínios próprios precisam estar apontados).
- Backup/snapshot do banco configurado no Railway.
- Monitoramento configurado (Analytics, Uptime Robot, logs do Railway).

---

## 🆘 Suporte e Próximos Passos

- Problemas comuns e procedimentos detalhados estão em `INSTRUCOES-PRODUCAO.md`.
- Ajuste as permissões dos comerciais conforme a operação (há inclusive permissão “Administrador”).
- Para novos ambientes, basta copiar `.env.example`, rodar `npm run db:migrate` e `npm run db:seed` após apontar o `DATABASE_URL`.
- Em caso de dúvidas: suporte@zenithpay.com.br / WhatsApp institucional.

**Desenvolvido para o time Zenith Pay.**
