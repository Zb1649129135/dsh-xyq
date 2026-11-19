# 小云雀

小云雀（XYQ / Pippit）用一句话生成图片和视频。干活的是官方
`pippit-tool-cli`，这个插件把它收进 DeepSeek Harness 里：agent 能直接生成素材，
人能看到发生了什么。

## 它带来什么

- 侧栏多一个 **小云雀** 面板行（挨着其它面板条目），设置里也多一页。两处显示同一件
  事：CLI 是否就位、是否已登录、还剩多少积分、图片与视频的模型目录，以及从这个
  harness 发起的任务。
- 输入框下面一个安静的状态胶囊，显示登录态和积分余额——凭证过期时你能在生成
  失败之前就察觉。
- 六个 agent 工具：`xyq_status`、`xyq_models`、`xyq_generate_image`、
  `xyq_generate_video`、`xyq_result`、`xyq_upload`。

三个座位，同一个页面。侧栏那一行才是可靠的门——承载设置座位的侧栏底部在有些 shell
里根本不画；每个座位都经 `slots.inject` 注册，缺席的座位只让那一项消失，不影响其它。

## CLI 才是引擎

所有操作都外挂 `pippit-tool-cli` 并读它的 JSON。这里不重写 HTTP 接口，所以升级
CLI 就等于扩展了插件的能力。查找顺序：

1. 插件配置里的 `cliPath`（如果设了）。
2. 已安装的 `@pippit-dev/cli` 包里的 `bin/pippit-tool-cli.exe`——依次翻 `PATH`、
   当前 Node 可执行文件周围、npm 全局目录、profile 自己的 `node_modules`。
3. 该包的 `scripts/run.js`，用当前 Node 可执行文件启动。

安装用 `npx @pippit-dev/cli@latest install`，登录用 `pippit-tool-cli login`。两者
缺任意一个，面板都会把提示再写一遍。

## 生成返回的是句柄，不是文件

`generate-image` 和 `generate-video` 提交任务，返回 thread id、run id 和一个网页
链接。素材随后才到。用 `xyq_result` 取，它调用 `query-result`，默认把文件下载进插件的
下载目录。每个任务都记在插件状态旁的 `runs.json` 里，所以重启之后面板仍能列出最近的
工作，`xyq_result` 也能只凭 id 续上。

## 重新加载

停用再启用插件就够让改动过的 `lib/*.js` 生效，不必重启。这听上去是个细节，却逼出了
一个设计决定。host 的 web server 会保留它接受过的 route 对象，同一 `(kind, path)`
第二次注册时直接抛错——抛错的是重载后的那次，于是留在原地的对象闭包着**旧的**模块副本。
结果就是：面板显示上一份任务日志和空的模型列表，而由新 fiber 服务的工具是对的。

所以每条路由都装一个跳板，去 `globalThis` 上那张 `Symbol.for` 表里取最新的 handler，
重载后的副本会覆盖它。任务日志也在每次读之前回读文件（另一个实例可能已经推进过它），
模型缓存拒绝保存空结果或失败结果，免得一次瞬时失败看起来像目录消失了五分钟。

有一点值得直说：跳板只有在真的有一条它自己的副本占着路由之后才管用。在这段代码存在之前
就启动的进程，会一直服务它当初注册的那个 handler，任何重载都碰不到它——因为 web server
也从不释放已经接受的路由。

这正是路径要带版本号的原因（`/dsh-xyq/v2/state`、`/dsh-xyq/v2/action`）。从未注册过的
路径一定是空的，所以提升版本号在一个已经跑了几小时的 harness 里也能干净地注册成功，
新副本立刻开始服务，不用重启。版本号写在两个文件里，因为 host 与 client 两半是各自独立的
bundle、无法互相 import；只能手工保持一致。只有旧路径自己吸收不了的改动才需要提升它，
平常的改动走跳板即可。

## 配置

| 键 | 含义 |
| --- | --- |
| `cliPath` | CLI 的显式路径。留空表示自动发现。 |
| `cwd` | CLI 调用的工作目录。CLI 从当前目录读 `config.toml`，要接 PPE 环境就改这里。 |
| `downloadDir` | `query-result` 保存素材的位置。留空表示 `<DSH home>/xyq/downloads`。 |
| `teamId` | 团队空间 id。留空走 CLI 自己的默认值；`0` 表示个人空间。 |
| `stateTtlMs` | 一份状态快照在下次调用 CLI 之前复用多久。 |

## 凭证

登录走 CLI 的浏览器 loopback 流程。插件从不读取、保存或打印 access key。
环境变量里的 `XYQ_ACCESS_KEY` 依然优先于浏览器登录——所以在这里退出只清除本机凭据，
清不掉 CLI 继承到的环境变量。
