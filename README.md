# TOKBLOX — corrida interativa TikTok + Roblox

Base inicial para ler comentários de uma live do TikTok, validar nomes de usuário Roblox, exibir os carros no Roblox Studio e liquidar apostas feitas **somente com pontos virtuais sem valor real**.

## Comandos no chat da live

| Comando | Ação |
| --- | --- |
| `NomeRoblox` ou `!entrar NomeRoblox` | Valida o usuário na API Roblox e coloca o carro na fila (até 8 corredores). |
| `!corrida` | Opcional: abre uma janela de apostas de 20 segundos e depois inicia a corrida. |
| `!apostar NomeRoblox 100` | Durante a janela de apostas, aposta de 1 a 1000 pontos virtuais no corredor indicado; cada pessoa pode apostar uma vez por corrida. |
| `!pontos` | Mostra no log do gateway o saldo virtual inicial/atual (1000 pontos na primeira participação). |

Quem acerta recebe o dobro da própria aposta; quem erra perde os pontos apostados. Não há compra, saque, Robux, presentes, dinheiro ou conversão de pontos. Os comentários do TikTok não recebem resposta automática: os resultados aparecem no servidor Roblox e no log do gateway.

## 1. Preparar o gateway

Requer Node.js 20 ou superior.

```powershell
npm install
Copy-Item .env.example .env
```

Edite `.env`: configure uma `ROBLOX_API_KEY` aleatória com pelo menos 32 caracteres e uma `DASHBOARD_API_KEY` com pelo menos 4 caracteres. A primeira é usada pelo servidor Roblox; a segunda protege o painel. Uma chave de painel mais longa é recomendada porque o site é público. `TIKTOK_USERNAME` é opcional: se preenchido, o gateway tenta conectar automaticamente ao iniciar; se deixado como está, conecte pelo painel.

Execute durante uma live:

```powershell
npm run start:local
```

Abra **http://localhost:3000**, use as abas fixas no topo para alternar entre **Painel da live**, **Configurar presentes** e **Teste Roblox**, cole a `DASHBOARD_API_KEY`, digite o usuário da live sem `@` e clique em **Conectar live**. Os comentários e presentes aparecem no painel automaticamente; o botão **Desconectar** encerra a conexão. O painel também mostra quais comentários contêm comandos reconhecidos. A chave é mantida apenas na memória da aba do navegador.

Na aba **Teste Roblox**, inicie a experiência no Roblox Studio com o script TOKBLOX ativo e clique em **Enviar teste ao Roblox**. O painel só confirma sucesso após o script receber o evento e responder ao gateway. O teste não inicia corridas nem altera pontos. Se não houver confirmação, confira a URL HTTPS pública, a chave `ROBLOX_API_KEY` e **Allow HTTP Requests** nas configurações da experiência.

O conector TikTok utilizado é uma biblioteca comunitária não oficial, baseada em interfaces internas do TikTok, e pode parar de funcionar quando o TikTok muda essas interfaces. O gateway processa apenas comentários recebidos após a conexão; mensagens do histórico inicial não acionam comandos. Use a integração apenas respeitando os termos e as regras aplicáveis. Em caso de erro de conexão, confira se o usuário está ao vivo e reinicie o gateway.

## Entrada automática na corrida

Espectadores podem comentar apenas o nick Roblox, por exemplo `Player_123`, ou usar `!entrar Player_123`. O gateway valida o nome na API do Roblox. O painel mostra o resultado da validação e informa se o jogador está na fila da próxima corrida ou foi adicionado a uma corrida em andamento; o evento enviado ao Roblox inclui o ID e o texto exato do comentário, além do usuário TikTok que o enviou. Quando o primeiro participante entra na fila, inicia uma contagem de 30 segundos; no fim dela a corrida começa automaticamente, mesmo com um único corredor. Se alguém enviar um nick enquanto a corrida está acontecendo, o carro entra na corrida ativa e começa a correr também. Cada corrida aceita até 8 participantes. O jogo mantém a inscrição aberta por 30 segundos após a largada e só encerra depois que os carros inscritos cruzarem a chegada. Comentários de uma única palavra que tenham formato de nome Roblox também são verificados como possíveis nicks.

`!corrida` continua disponível para abrir manualmente uma rodada de apostas virtuais com a fila atual.

## Configurar presentes da live

No painel, abra a aba **Presentes** e conecte-se à live. Os presentes enviados são descobertos automaticamente e aparecem em **Presentes detectados** com nome e ID preenchidos pelo TikTok. Em cada presente, escolha o que acontece no jogo e clique em **Adicionar** ou **Salvar**:

- **Chuva de confete**: partículas visuais ao redor dos carros.
- **Brilho neon nos carros**: realce temporário nos carros.
- **Mensagem de celebração**: mostra o nome de quem enviou o presente acima dos carros.

O script Roblox precisa estar ativo para mostrar os efeitos. Presentes apenas disparam efeitos visuais: não alteram velocidade, apostas ou saldo virtual. Configurações são salvas em `data/gift-config.json` e continuam após reiniciar o gateway. Presente não configurado ainda aparece na lista de presentes detectados, mas não aciona efeito. Presentes enviados em sequência só são processados quando a sequência termina.

## 2. Publicar no Render

O arquivo `render.yaml` configura o TOKBLOX como um serviço web Node.js, instala as dependências com `npm ci`, usa a porta fornecida pelo Render, verifica a rota `/health` e gera chaves para `ROBLOX_API_KEY` e `DASHBOARD_API_KEY`. A `ROBLOX_API_KEY` precisa ter pelo menos 32 caracteres; a `DASHBOARD_API_KEY`, pelo menos 4. Para o painel, você pode substituir o valor gerado por uma chave própria nas variáveis do serviço, mas uma chave maior é mais segura.

1. Envie este projeto para um repositório GitHub.
2. No Render, escolha **New → Blueprint**, conecte o repositório e confirme a implantação do `render.yaml`.
3. Aguarde o deploy e abra a URL HTTPS gerada pelo Render para acessar o painel.
4. No painel do serviço, copie `ROBLOX_API_KEY` para o script do Roblox e use `DASHBOARD_API_KEY` para entrar no painel. Não compartilhe essas chaves.
5. Opcionalmente, defina `TIKTOK_USERNAME` nas variáveis do serviço para tentar conectar à live ao iniciar; deixe-a ausente para conectar pelo painel.
6. No script Roblox, defina `API_BASE_URL` com a URL HTTPS do Render, sem `/` no final, e `API_KEY` com o valor de `ROBLOX_API_KEY`. Habilite **Allow HTTP Requests** e execute a experiência.

O Blueprint usa o plano gratuito. Serviços gratuitos podem dormir quando não recebem requisições e o sistema de arquivos não é persistente: corridas e saldos já são mantidos em memória, e as regras de presentes em `data/gift-config.json` podem ser perdidas em reinicializações ou novos deploys. Para manter a configuração de presentes e evitar suspensão durante uma live, use um serviço pago com disco persistente e adicione um disco montado em `/opt/render/project/src/data`.

## 3. Outras opções de hospedagem

O servidor Roblox precisa acessar o gateway por uma URL pública HTTPS. `localhost` só é acessível na sua máquina e não funciona a partir dos servidores do Roblox. Em outros provedores Node.js, configure `npm ci` como build e `npm start` como inicialização; mantenha `.env` fora do controle de versão e defina `ROBLOX_API_KEY`, `DASHBOARD_API_KEY` e, opcionalmente, `TIKTOK_USERNAME`. O provedor deve fornecer `PORT`.

## 4. Configurar o Roblox Studio

1. Abra uma experiência sua no Roblox Studio.
2. Em **Game Settings → Security**, habilite **Allow HTTP Requests**.
3. Crie um `Script` em `ServerScriptService` e copie o conteúdo de `roblox/ServerScriptService/LiveRace.server.lua`.
4. Substitua `API_BASE_URL` pela URL HTTPS pública do gateway (sem `/` no final) e `API_KEY` pela mesma chave configurada no gateway.
5. Publique e execute a experiência em um servidor de teste.

O script cria uma pista simples e carros estilizados com o nome Roblox acima deles. As velocidades são sorteadas no servidor Roblox e o primeiro carro a cruzar a linha de chegada vence. As apostas são liquidadas pelo gateway quando ele recebe o resultado.

## 5. Testes

```powershell
npm test
```

## Limitações desta base

- Saldos, fila, corrida e histórico de eventos ficam em memória; reiniciar o gateway zera os dados e exige reiniciar a experiência Roblox.
- A corrida é uma demonstração com carros ancorados e velocidades sorteadas, não um sistema de veículos dirigíveis nem uma competição física validada contra trapaças.
- Proteja a chave do gateway: qualquer pessoa com a chave pode ler eventos e enviar resultados de corrida.
- Faça testes privados antes de usar em uma live. A biblioteca de comentários não é uma API oficial do TikTok.
