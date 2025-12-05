# 🚀 Sistema de Simulação Zenith

Painel administrativo (desktop) e fluxo mobile do Sistema de Simulação Zenith Pay preparados para deploy único.

> Atualização: os arquivos HTML foram sincronizados com o pacote `C:\Users\rbast\Downloads\sistema-zenith-producao-final` (versão v4.0 do sistema de simulação/cotação). O bundle anterior (`sistema-investimentos-zenith-final`) continha apenas o painel de investimentos e foi substituído aqui pelo sistema completo, com todos os formulários e ações funcionando.

---

## 📂 Conteúdo do Repositório

- `sistema_de_simulacao_zenith.html` – versão desktop/responsiva (login + dashboards por perfil).
- `sistema_de_simulacao_zenith_mobile.html` – experiência mobile dedicada.
- `zenith-logo.png` – logo oficial usada nas telas.
- `server.js` – servidor HTTP simples (Node) que expõe `/` e `/mobile`.
- `package.json` – scripts (`npm run dev` / `npm start`) e configuração para o Railway.
- `INSTRUCOES-PRODUCAO.md` – guia detalhado de publicação e checklist final.

---

## 🧩 Funcionalidades Principais

- Login validando `admin / admin123` e controle de sessão com bloqueio do app até autenticar.
- CRUD de serviços, clientes e comerciais com formulários dedicados, botões de editar/excluir e feedback visual em tabelas dinâmicas.
- Simulador/gerador de cotações completo (`calcularCotacao`, `salvarCotacao`, filtros por status, atualização em tempo real das listas de abertas/fechadas).
- Painel de indicadores atualizado por `atualizarDashboard()` (contagem de cotações, valores movimentados, clientes ativos).
- Versão mobile com navegação em abas, cards responsivos e as mesmas ações centrais (login, dashboards, formulários e filtros operacionais).
- Dashboard/listas mostram dados globais para administradores e apenas as cotações do agente logado para usuários comerciais.
- Admin define senha e permissões por comercial (todas as abas: Dashboard, Nova Cotação, Cotações, Clientes, Comerciais e Admin-Serviços) podendo conceder o perfil “Administrador” para liberar 100% do sistema.
- Todas as alterações ficam salvas no `localStorage`, permitindo editar serviços, clientes, comerciais e cotações e retomar o trabalho após atualizar a página.

---

## 🧪 Execução Local

1. Certifique-se de ter **Node.js 18+** instalado.
2. Na pasta do projeto, rode `npm install` (opcional, não há dependências) e depois:
   ```bash
   npm run dev
   # ou
   npm start
   ```
3. Acesse `http://localhost:3000` (desktop). Para validar a versão mobile, use `http://localhost:3000/mobile`.
4. Credenciais padrão: `admin` / `admin123` (não deixe em produção!). Comerciais devem usar o CPF (ou a chave PIX cadastrada) + a senha configurada no menu **Comerciais**.

---

## ☁️ Deploy com Railway

1. Instale o [Railway CLI](https://docs.railway.app/develop/cli) e faça login (`railway login`).
2. Dentro do projeto, execute `railway init` e escolha **Deploy from Source**.
3. Confirme o diretório atual como raiz e mantenha `npm start` como comando padrão.
4. Envie o código com `railway up`.
5. Após o deploy, adicione a variável `PORT` (Railway cria automaticamente) caso deseje porta fixa. A aplicação responde em `/` e `/mobile`.

> O Railway detecta o `package.json` e roda `npm install` seguido de `npm start` automaticamente. Nenhuma outra configuração é necessária.

---

## 📦 Alternativa: Deploy Estático Manual

1. Faça upload de `sistema_de_simulacao_zenith.html`, `sistema_de_simulacao_zenith_mobile.html` e `zenith-logo.png` para seu servidor (Apache/Nginx ou cPanel).
2. Defina `index.html` → `sistema_de_simulacao_zenith.html` e `mobile.html` → `sistema_de_simulacao_zenith_mobile.html` ou configure as rotas desejadas.
3. Garanta permissões `644` para os arquivos e ative HTTPS.
4. Consulte `INSTRUCOES-PRODUCAO.md` para o passo a passo completo, checklist e recomendações de segurança.

---

## ✅ Checklist Rápido

- Logo é exibida em ambas as versões.
- Credenciais alteradas antes do go-live.
- Testes em navegadores desktop e dispositivos móveis reais.
- HTTPS ativo (Let's Encrypt ou similar).
- Backup dos arquivos realizado.
- Monitoramento configurado (Analytics/Uptime Robot).

---

## 🆘 Suporte e Próximos Passos

- Problemas comuns e roadmap sugerido estão detalhados em `INSTRUCOES-PRODUCAO.md`.
- Reforce a segurança implementando autenticação real (backend + storage seguro) e limitação de tentativas.
- Em caso de dúvidas: suporte@zenithpay.com.br / WhatsApp institucional.

**Desenvolvido para o time Zenith Pay.**
