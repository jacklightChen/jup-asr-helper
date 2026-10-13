# JUP ASR 签名助手

简体中文 · [English](README.md) · [GitHub 仓库](https://github.com/jacklightChen/jup-asr-helper) · [打开助手](https://jup-asr-helper.github.io/)

开源领取助手：使用 **Binance Wallet、Phantom、OKX Wallet、Backpack、MetaMask、Solflare 或 Trust Wallet** 核对并领取 Jupiter ASR 奖励。可在支持的钱包手机 DApp 浏览器，或启用了钱包扩展的电脑浏览器中打开。每位访问者连接自己的 Solana 账户，并在钱包中授权每笔交易。本项目独立于 Jupiter 和所列钱包。

GitHub Pages 网站地址：[jup-asr-helper.github.io](https://jup-asr-helper.github.io/)。手机端请在支持的钱包内打开该链接，以连接钱包。

## 当前支持情况

目前仅支持 **ASR 2026 Q3**（`asr-2026-q3`）。官方公布的领取截止时间是 **2027 年 1 月 12 日 14:00 UTC**，即北京时间 **22:00**。页面会读取实时活动时间，并在领取窗口外停止准备交易。参见[官方活动](https://jup.ag/rewards/asr-2026-q3)。

| 钱包 | 连接方式 |
| --- | --- |
| Binance Wallet | Solana Wallet Standard |
| Phantom | Wallet Standard 或官方 `window.phantom.solana` provider |
| OKX Wallet | 优先使用官方 `window.okxwallet.solana` provider；回退到 Wallet Standard |
| Backpack | Wallet Standard 或 `window.backpack` provider |
| MetaMask | 原生 Solana Wallet Standard 注册 |
| Solflare | Wallet Standard 或 `window.solflare` provider |
| Trust Wallet | 官方 `Trust` Wallet Standard 注册；注入的 Solana provider 回退 |

钱包发现要求名称匹配、支持 Solana 主网，并提供 `standard:connect` 和只签名的 `solana:signTransaction`。同时支持 `solana:mainnet` 别名和主网 CAIP-2 标识。只有 EVM 接口的 MetaMask 无法连接。连接弹窗始终显示全部支持钱包，包括 Binance Wallet。已检测到 Solana 接口的钱包可以直接点击卡片连接；未检测到时，显示在钱包内打开页面或启用扩展的说明。同一钱包有多个实例时，可选择对应卡片。OKX 官方 provider 可用时优先使用，以读取当前选中的 Solana 账户及账户切换事件。旧格式交易以原生 `Transaction` 传给注入接口，v0 格式使用 `VersionedTransaction`。注入适配器调用各钱包的官方 Solana 交易接口，所有返回的签名都经过相同的本地消息与签名核验，再由 Jupiter `postClaim` 提交。

适配器测试、Wallet Standard 接口样例及真实验证范围记录在[钱包兼容性检查](docs/wallet-compatibility.md)中。

集成参考：[Binance Solana 接口](https://developers.binance.com/en/docs/products/web3-connect/solana-provider)、[Phantom provider](https://docs.phantom.com/solana/sending-a-transaction)、[OKX Solana provider](https://web3.okx.com/onchainos/dev-docs/wallet/dapp-connect/chains/solana/provider)、[Backpack](https://docs.backpack.app/)、[MetaMask Wallet Standard 功能](https://docs.metamask.io/metamask-connect/solana/reference/methods/)、[Trust Wallet Solana provider](https://github.com/trustwallet/trust-web3-provider/tree/main/packages/solana)、[Solflare SDK](https://docs.solflare.com/solflare/technical/integrate-solflare/solflare-wallet-sdk)。

工具通过 Jupiter 活动 API 准备领取交易，在钱包授权和本地核验后提交。领取结果可能受接口可用性、钱包版本及个人资格影响。

奖励是 **Staked JUP**，领取后进入 JUP 质押账户。已核对的交易可能创建质押账户并开启持续质押（`max lock`）。之后若要提取，需要关闭持续质押并等待规定的 **7 天**。签名前请核对实际交易及当时的 [Jupiter 质押页面](https://vote.jup.ag/)。

## 钱包使用步骤

1. 手机端在 **支持钱包的 DApp 浏览器**中打开已部署网站的 HTTPS 地址；电脑端在启用了支持的钱包扩展的浏览器中打开。不同版本的菜单名称可能有区别；没有注入支持钱包的普通浏览器无法连接。
2. 选择 **简体中文 / English**，点击 **连接钱包**，再在弹窗中选择钱包卡片，授权获得奖励的 Solana 账户。页面会查询这个账户的奖励。
3. 点击 **准备交易**，核对奖励数量、质押影响、手续费付款账户、调用程序与 SOL 费用估算。
4. 点击 **签名并提交**按钮，在所选钱包中查看交易并确认。钱包里的明确授权是最终签名步骤。
5. 点击 **查询领取状态**，并检查链上交易结果。如果提交请求超时，请先查奖励状态及钱包交易记录；页面不会自动重复提交。

交易准备后 45 秒过期，以减少区块哈希过期造成的失败。收到提示时重新准备即可。钱包需要有 SOL 支付网络费与可能新增的账户租金。租金常量来自已核对的账户大小和当前参数，估算可能变化，实际费用以钱包预览及最终交易为准。

如果未检测到钱包，请在钱包内置 DApp 浏览器重新打开链接，或启用电脑扩展后刷新，并检查当前版本是否提供上文要求的连接及只签名方法。如果 Jupiter 拒绝当前钱包或领取请求，请使用官方支持的领取方式。不要修改钱包身份或合约检查来强制提交。

## 页面会检查什么

- 已连接的主网账户、手续费付款账户与必要签名账户一致。
- 活动、JUP 代币、分发账户、质押合约、派生领取账户、允许的程序、指令数据及奖励数量与已核对活动一致。
- 拒绝未知程序、转账、账户目的地、异常指令结构、地址查找表、重复操作及过高的网络费估算。
- 钱包返回的已签名交易与原交易消息完全一致，且签名由当前账户生成；保留已有签名。
- 账户变化会清除已准备交易，提交后重新查询奖励状态。

这些检查覆盖当前支持的交易结构，不能代替合约审计。测试使用随机生成的测试密钥，不使用真实用户的密钥。

## 隐私

无需助记词、私钥、Binance 交易所 API Key 或 Reown Project ID。前端没有分析统计或应用后端，只在 `localStorage` 保存界面语言；钱包连接与交易状态保留在当前页面内存中。Jupiter 会在领取查询时收到钱包公开地址，在提交时收到已签名领取交易。捐赠记录查询会向 PublicNode 的 Solana 主网 RPC 发送公开的收款地址和交易编号。自愿捐赠也通过该 RPC 查询余额并提交，该服务会收到公开地址和已签名的捐赠转账。托管及 API 提供商可能保留自己的请求日志。仓库不包含个人奖励数量或已签名交易；下方自愿捐款地址为公开信息。

## 开发

前端与构建脚本使用 TypeScript，并启用严格类型检查。使用 Node.js 24 与 npm；Node 通过原生类型擦除运行构建脚本和测试导入。按锁文件安装依赖，检查类型并运行交易测试，再构建静态网站：

```sh
npm ci
npm run typecheck
npm test
npm run build
```

构建产物包括 `dist/index.html`、`dist/assets/` 中按内容哈希命名的脚本和样式、`dist/icons/` 中的钱包图标，以及 `dist/asset-manifest.json`，并保留 `app.js`、`style.css` 兼容副本。资源哈希避免缓存的 HTML 与脚本、样式混用版本。`npm run build:pages` 会同步更新部署仓库根目录资源，并保留旧哈希文件供缓存页面使用。资源采用相对路径，支持组织主页和项目子路径。查看本地布局：

```sh
python3 -m http.server 8080 --directory dist
```

在开发电脑打开 `http://localhost:8080`，支持的钱包电脑扩展可能在 localhost 页面注入接口。连接真实手机钱包时，请部署为 HTTPS，并在支持的钱包内打开网站；手机的 `localhost` 指向手机本身。测试不会请求真实钱包签名，也不会广播交易。

## API 流程

页面直接请求 Jupiter，不经过代理。当前活动基础地址：

```text
https://datapi.jup.ag/rewards/v1/campaigns/asr-2026-q3
```

| 方法 | 相对于基础地址的路径 | 用途 |
| --- | --- | --- |
| GET | `/` | 读取活动信息与领取时间 |
| GET | `/stats/{address}` | 查询已连接账户的奖励状态 |
| GET | `/claim?address={address}` | 获取未签名领取交易 |
| POST | `/postClaim` | 钱包授权并完成本地签名核验后，提交 `{ "address": "…", "signedTx": "…" }` |

这些活动接口来自对 Jupiter 奖励应用流程的观察，可能变化或拒绝不支持的客户端。返回格式无法识别时，页面会停止操作。本项目不提供使用私钥的通用命令行签名示例。

支持后续 ASR 活动前，需要重新核对活动信息、合约及分发地址、指令结构、账户派生方式、费用及租金假设，并更新测试。只改活动名称并不足够。当前常量在 [`src/transaction.ts`](src/transaction.ts)，API 与钱包流程在 [`src/app.ts`](src/app.ts)。

## GitHub Pages

源码维护在 [`jacklightChen/jup-asr-helper`](https://github.com/jacklightChen/jup-asr-helper)。网站由 [`jup-asr-helper/jup-asr-helper.github.io`](https://github.com/jup-asr-helper/jup-asr-helper.github.io) 发布，保留其已启用的 **Deploy from a branch → `main` → `/ (root)`** 配置。无需自定义域名或部署密钥，其他 GitHub Pages 设置保持不变。

发布前运行 `npm run typecheck`、`npm test` 和 `npm run build`，将源码提交并推送到个人仓库。将本次发布的 `src/`、`test/`、`build.ts`、`tsconfig.json`、package 文件和 README 同步到组织主页仓库的独立检出目录，保留它的部署检查工作流。在该目录运行 `npm ci`、`npm run typecheck`、`npm test`、`npm run build:pages`，随后提交所有更新的源码与构建资源，推送组织仓库的 `main` 分支。保留 `.nojekyll` 和 `assets/` 中的旧哈希文件，缓存的 HTML 仍可能引用它们。
源码的 [CI 工作流](https://github.com/jacklightChen/jup-asr-helper/blob/main/.github/workflows/ci.yml)会检查类型、测试并构建。部署仓库还会检查已提交的页面资源与源码快照一致，这些检查均不修改 Pages 设置。组织仓库的 `main` 更新后，GitHub 的 **pages build and deployment** 工作流发布到 [https://jup-asr-helper.github.io/](https://jup-asr-helper.github.io/)。参见 [GitHub 发布来源官方文档](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

## 许可证

本项目源代码采用 [MIT](LICENSE) 许可证，第三方依赖保留各自的许可证。

## 支持开发

如果工具对你有帮助，欢迎自愿捐赠，支持开发。

Solana 捐款地址：

```text
5QDviToVpnePujox1tm3cwSsAwp9WKChiaJnWWSbHS3H
```

连接钱包后，可使用 **捐赠 0.01 SOL** 或 **捐赠 0.05 SOL** 按钮。每次都会单独向上方地址转入所选 SOL，另需支付网络费，并由钱包授权确认。工具核对唯一一笔 SOL 转账的固定收款地址、金额、已连接的付款账户，并核验钱包返回交易的真实签名后，通过 [PublicNode Solana 主网 RPC](https://solana.publicnode.com/) 提交。捐赠允许钱包在 legacy/v0 格式之间重建、更新区块哈希，以及在转账前添加最多两条已识别的计算预算指令。本地费用上限和提交前查询的实际网络费都必须不超过 **0.00005 SOL**。额外转账、程序、签名账户、未知账户及地址查找表会被拒绝。提交前再次检查实际手续费、当前余额、区块哈希有效性以及钱包账户是否改变。OKX 支持时优先使用旧格式捐赠交易；其他只提供旧格式的钱包也会自动选择旧格式。ASR 领取仍要求交易消息的每个字节一致。收到交易编号不等于确认成功，请使用 **查询捐赠状态** 或链上链接核实。提交或确认结果未知时，按钮保持禁用，避免重复转账；不会自动重新发送。参见 Solana [提交交易](https://solana.com/docs/rpc/http/sendtransaction)与[确认状态](https://solana.com/docs/rpc/http/getsignaturestatuses)文档。

捐赠区还会查询该地址最近 20 笔已确认交易，展示最多 10 条 SOL 转入记录，包括发送地址、精确 SOL 金额、UTC+8 时间和 Solscan 交易链接。通过钱包手动转入的 SOL 也可能显示。链上记录无法证明捐赠意图，因此这是近期转入视图，不代表完整捐赠账本。只统计成功的 System Program 转账（包括内部指令），排除转出、代币转账和租金相关余额变化。可手动刷新，页面确认捐赠成功后也会刷新。查询无需连接钱包或签名；RPC 查询失败或不完整时会显示提示，不影响领取。参见 Solana [签名记录](https://solana.com/docs/rpc/http/getsignaturesforaddress)与[解析交易](https://solana.com/docs/rpc/http/gettransaction)文档。

捐赠完全自愿，不影响领取资格。公共 RPC 可用性及限流可能影响按钮，也可以在钱包中手动转账。

## 免责声明

本工具是独立社区项目，按现状提供，不构成投资建议。接口、钱包版本与个人资格可能影响领取结果；签名前请自行核对网络、收款地址、金额和质押操作。链上确认的转账无法由本工具撤回。捐赠与 ASR 领取分开。
