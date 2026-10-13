# JUP ASR 签名助手

简体中文 · [English](README.md) · [GitHub 仓库](https://github.com/jacklightChen/jup-asr-helper) · [打开助手](https://jup-asr-helper.github.io/)

开源领取助手：使用 **Binance Wallet 或 Phantom** 核对 Jupiter ASR 交易，并由用户授权签名。Binance 通过 Solana Wallet Standard 连接，Phantom 通过官方注入的 Solana provider 连接。可在支持的钱包手机 DApp 浏览器，或装有钱包扩展的电脑浏览器中打开。每位访问者连接自己的 Solana 账户。本项目是独立的社区工具，与 Binance、Phantom、Jupiter 均无隶属关系。

GitHub Pages 网站地址：[jup-asr-helper.github.io](https://jup-asr-helper.github.io/)。手机端请在 Binance Wallet 或 Phantom 内打开该链接，以连接钱包。

## 当前支持情况

目前仅支持 **ASR 2026 Q3**（`asr-2026-q3`）。官方公布的领取截止时间是 **2027 年 1 月 12 日 14:00 UTC**，即北京时间 **22:00**。页面会读取实时活动时间，并在领取窗口外停止准备交易。参见[官方活动](https://jup.ag/rewards/asr-2026-q3)。

**用户已于 2026 年 10 月 13 日确认：通过手机 Binance Wallet 成功领取。** 这次测试验证了手机签名与 API 提交流程。开发期间也已成功构造未签名交易并通过 Solana RPC 模拟。

| 钱包 | 连接方式 | 验证情况 |
| --- | --- | --- |
| Binance Wallet | 手机 DApp 浏览器；提供所需 Solana Wallet Standard 功能的电脑扩展 | 用户已于 2026 年 10 月 13 日确认手机领取成功；电脑扩展领取尚未测试 |
| Phantom | 手机内置浏览器或电脑扩展注入的官方 Solana provider | 使用随机生成的测试交易验证适配器，并执行相同的签名检查；尚未确认真实 Phantom 领取成功 |

Binance 钱包发现要求支持 Solana 主网，并提供 `standard:connect` 和 `solana:signTransaction`。Phantom 会检查 `window.phantom.solana.isPhantom`，并要求注入的 provider 提供 `connect` 和 `signTransaction`。检测到多个支持的钱包时，连接前在页面的钱包选择器中选择要使用的钱包。参见 [Binance Solana 官方接口文档](https://developers.binance.com/en/docs/products/web3-connect/solana-provider)和 [Phantom 官方 provider 检测文档](https://docs.phantom.com/solana/detecting-the-provider)。

Phantom 当前的 Wallet Standard 接口不提供只签名的 `signTransaction`，[官方注入的 provider 则提供这一方法](https://docs.phantom.com/solana/sending-a-transaction)。本工具适配该 provider 的 legacy 和 v0 交易，在本地核对签名及交易消息未被修改后，通过 Jupiter `postClaim` 提交，不调用 Phantom 的直接签名广播路径。实现参考了 [Phantom 钱包适配器](https://github.com/anza-xyz/wallet-adapter/blob/master/packages/wallets/phantom/src/adapter.ts)的 provider 用法。如果已安装的钱包版本不提供只签名接口，页面不会启用签名。

当前活动元数据设置了 `onlyClaimableThroughJup: true`。页面会同时展示官方标记和已反馈的 Binance Wallet 领取成功情况。工具使用钱包的真实账户与签名，不伪装成 Jupiter Wallet，也不修改领取资格。之后的领取仍可能受接口可用性、钱包版本及个人资格影响。

奖励是 **Staked JUP**，领取后进入 JUP 质押账户。已核对的交易可能创建质押账户并开启持续质押（`max lock`）。之后若要提取，需要关闭持续质押并等待规定的 **7 天**。签名前请核对实际交易及当时的 [Jupiter 质押页面](https://vote.jup.ag/)。

## 钱包使用步骤

1. 手机端在 **Binance Wallet 的 DApp 浏览器**或 **Phantom 的内置浏览器**中打开已部署网站的 HTTPS 地址；电脑端在启用了支持的钱包扩展的浏览器中打开。不同版本的菜单名称可能有区别；没有注入支持钱包的普通浏览器无法连接。
2. 选择 **简体中文 / English**。若检测到多个钱包，先选择要使用的钱包，再点击 **连接钱包**，授权获得奖励的 Solana 账户。页面会查询这个账户的奖励。
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

无需助记词、私钥、Binance 交易所 API Key 或 Reown Project ID。前端没有分析统计或应用后端，只在 `localStorage` 保存界面语言；钱包连接与交易状态保留在当前页面内存中。Jupiter 会在查询时收到钱包公开地址，在用户提交时收到已签名交易。托管及 API 提供商可能保留自己的请求日志。仓库不包含个人奖励数量或已签名交易；下方自愿捐款地址为公开信息。

## 开发

使用 Node.js 24 与 npm。按锁文件安装依赖，运行交易检查，然后构建静态网站：

```sh
npm ci
npm test
npm run build
```

构建产物是 `dist/index.html`、`dist/app.js` 和 `dist/style.css`。发布改动前运行 `npm run build:pages`，同时更新仓库根目录中需要提交的 `index.html`、`app.js`、`style.css` 和 `.nojekyll`。资源使用 `./` 相对路径，可以部署为组织主页，也可以部署到 GitHub Pages 的项目子路径。查看本地布局：

```sh
python3 -m http.server 8080 --directory dist
```

在开发电脑打开 `http://localhost:8080`，支持的钱包电脑扩展可能在 localhost 页面注入接口。连接真实手机钱包时，请部署为 HTTPS，并在 Binance Wallet 或 Phantom 内打开网站；手机的 `localhost` 指向手机本身。测试不会请求真实钱包签名，也不会广播交易。

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

支持后续 ASR 活动前，需要重新核对活动信息、合约及分发地址、指令结构、账户派生方式、费用及租金假设，并更新测试。只改活动名称并不足够。当前常量在 [`src/transaction.mjs`](src/transaction.mjs)，API 与钱包流程在 [`src/app.mjs`](src/app.mjs)。

## GitHub Pages

源码维护在 [`jacklightChen/jup-asr-helper`](https://github.com/jacklightChen/jup-asr-helper)。网站由 [`jup-asr-helper/jup-asr-helper.github.io`](https://github.com/jup-asr-helper/jup-asr-helper.github.io) 发布，保留其已启用的 **Deploy from a branch → `main` → `/ (root)`** 配置。无需自定义域名或部署密钥，其他 GitHub Pages 设置保持不变。

发布改动前，运行 `npm test` 和 `npm run build`，将源码提交并推送到个人仓库。随后在组织主页仓库的独立检出目录中，用 `dist/index.html`、`dist/app.js`、`dist/style.css` 更新根目录的对应文件，保留 `.nojekyll`，提交并推送组织仓库的 `main` 分支。也可以在部署目录中运行 `npm run build:pages`，更新根目录页面资源。

源码的 [CI 工作流](https://github.com/jacklightChen/jup-asr-helper/blob/main/.github/workflows/ci.yml)会测试并构建。部署仓库还会检查已提交的页面资源与源码快照一致，这些检查均不修改 Pages 设置。组织仓库的 `main` 更新后，GitHub 的 **pages build and deployment** 工作流发布到 [https://jup-asr-helper.github.io/](https://jup-asr-helper.github.io/)。参见 [GitHub 发布来源官方文档](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

## 许可证

本项目源代码采用 [MIT](LICENSE) 许可证，第三方依赖保留各自的许可证。

## 支持开发

如果工具对你有帮助，欢迎自愿捐赠，支持开发。

Solana 捐款地址：

```text
5QDviToVpnePujox1tm3cwSsAwp9WKChiaJnWWSbHS3H
```

捐赠为自愿支持，与 ASR 领取分开。
