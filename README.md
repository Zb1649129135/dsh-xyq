# dsh-xyq

DeepSeek Harness 的小云雀（XYQ / Pippit）插件。它把 `pippit-tool-cli` 搬进
harness：侧栏一个面板显示登录态与积分，输入框下方一个状态胶囊，另有六个 agent
工具，可以生成图片与视频、上传素材、取回结果。

## 安装

先装引擎，再装插件：

```bash
npx @pippit-dev/cli@latest install   # 引擎
pippit-tool-cli login                # 然后登录

dsh plugin --profile web add dsh-xyq # 插件
```

profile 不叫 `web` 就换成自己的名字；要钉版本就写 `dsh-xyq@0.2.0`。
装完在侧栏点「小云雀」，或者在 Settings 里找同一页。

桌面版（DeepSeek Harness Desktop）的 profile 由应用自己看管，上面那条 `dsh`
命令会直接拒绝 `--profile desktop`。桌面用户走应用内：Settings → Plugins，
输入 `dsh-xyq` 安装。非要用命令行的话，先完全退出桌面应用，再用应用自带的那个
CLI（它带管理桌面 profile 的权限）：

```bash
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add dsh-xyq
```

从仓库直接跑开发版时，装目录而不是包名——pnpm 会把它链接进来，`files` 也就不
再过滤文件：

```bash
dsh plugin --profile web add /绝对路径/dsh-xyq
```

插件声明了三个客户端座位，任意一个都能到达它：

| 座位 | 画什么 |
| --- | --- |
| `sidebar.panellist` + `main` | 侧栏的「小云雀」行，以及点开后的面板页。 |
| `settings.section` | 设置里的一页，order 63。 |
| `conversation.composer.dock` | 输入框下方的状态胶囊。 |

每个座位都经 `slots.inject` 注册，所以不声明该座位的 shell 只会让那一项缺席，
不会让插件启动失败。

## 工具

| 工具 | 作用 |
| --- | --- |
| `xyq_status` | CLI 位置与版本、登录态、凭证到期时间、积分余额。 |
| `xyq_models` | 图片或视频模型目录；传名字则描述单个模型。 |
| `xyq_generate_image` | 提交图片任务。需要 `prompt` 与 `model`。 |
| `xyq_generate_video` | 提交视频任务，可带参考图、参考视频、参考音频。 |
| `xyq_result` | 读任务、下载素材、报告落盘位置。 |
| `xyq_upload` | 上传本地文件或 HTTPS URL，返回素材 id。 |

生成返回 thread id、run id 和网页链接——素材随后才到，`xyq_result` 就是用来取它的。
两个 id 给一个就够，另一个从任务日志里补。

## 产物落在哪

在对话里提交的任务，素材落在**那个会话的工作区**里，一个任务一个文件夹：

```
<工作区>/.xyq/<run id 前 8 位>/
```

目录在提交时就写进任务日志，所以之后从哪一端查询（面板按钮、`xyq_result`、另一
个会话）都落回同一个位置。`downloadDir` 不再是所有任务的公共落点，它只接没有工
作区的任务——比如早于这次改动提交的老任务。`xyq_result` 的 `dir` 参数可以临时改
一次落点，不会写回任务。

面板里每条任务旁都有「打开文件夹」，结果卡片也会显示这一次的目录。

## 结构

```
dsh-xyq/
  lib/cli.js      定位启动方式、解析 JSON、每次调用一个子进程
  lib/store.js    状态目录、任务日志、原子写 JSON
  lib/ops.js      所有 CLI 操作，以及缓存的快照
  lib/index.js    工具与 web 路由（host 半边）
  lib/client.js   侧栏面板、设置页与输入框胶囊（web 半边）
  locale/         en.json、zh.json —— 插件管理器的元数据
  detail/         插件详情页那段长描述
  assets/pay/     微信、支付宝收款码
```

## 配置

`cliPath`、`cwd`、`downloadDir`、`teamId`、`stateTtlMs`——说明见
[detail/DETAIL.zh.md](detail/DETAIL.zh.md)。它们写在插件行上，改动不用重新构建。
`downloadDir` 只是没有工作区的任务（以及老任务）的落点。

## 说明

- 插件从不读取 access key。登录外挂 `pippit-tool-cli login`，凭证由 CLI 自己保存。
- 后台不做任何轮询。面板在打开、窗口获得焦点、手动刷新时更新；胶囊共用同一份快照。
- web 路由要求 harness 的浏览器会话，所以脚本（以及有 shell 权限的模型）无法代你驱动 CLI。
- 停用再启用插件就够让改动过的 `lib/*.js` 生效，不必重启。路由由插件的 fiber 持有；
  沿用下来的那个 route 对象通过 `globalThis` 上的表读取最新的 handler，
  因为 web server 不允许同一路径注册第二次。
- 那个跳板只有在真的有一条它自己的副本占着路由之后才管用。早于它启动的 harness
  会一直服务当初注册的 handler，任何重载都够不到它——所以路径带一段版本号
  （`/dsh-xyq/v2/…`）。从未注册过的路径一定是空的，这正是版本号能在运行中的
  harness 上生效的原因。只有旧路径自己吸收不了的改动才需要提升这个版本号，
  平常的改动走跳板即可。

## 请作者喝杯咖啡

这个插件是下班之后、周末之前，一点一点挤时间写出来的。中间踩的坑不少：
`pippit-tool-cli` 的 stdout 随时会多出一行提示，JSON 得从噪声里捞；harness 的
web server 不允许同一路径注册第二次，路由只能靠 `globalThis` 上的表做跳板；
侧栏面板要同时伺候三个客户端座位，缺一个也不能让插件起不来。这些都没有预算，
也没有排期，靠的只是「自己也想用」这一条。

所以它不收费、不带广告、不收集任何数据，代码全部摆在这里，随便看、随便改。
如果它确实替你省下了几个小时，或者你只是希望它别在某天悄悄停更——可以扫下面
的码，请我喝杯咖啡。金额随意，一元的速溶和三十元的手冲，提神效果是一样的。

| 微信 | 支付宝 |
| :---: | :---: |
| <img src="assets/pay/wechat.png" alt="微信收款码" width="220"> | <img src="assets/pay/alipay.png" alt="支付宝收款码" width="220"> |

不方便扫码也完全没关系。提一个 issue 说清楚哪一步卡住了、把文档里含糊的地方
指出来、或者只是把插件转给可能用得上的朋友——这些支持比钱实在，也更能让它
变得好用。

谢谢你看完这一段，也谢谢你把时间花在这里。
