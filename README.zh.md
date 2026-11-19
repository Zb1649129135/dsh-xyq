# dsh-xyq

DeepSeek Harness 的小云雀（XYQ / Pippit）插件。它把 `pippit-tool-cli` 搬进
harness：侧栏一个面板显示登录态与积分，输入框下方一个状态胶囊，另有六个 agent
工具，可以生成图片与视频、上传素材、取回结果。

```bash
npx @pippit-dev/cli@latest install   # 引擎
pippit-tool-cli login                # 然后登录
```

然后用 `plugin_manager install_bundle` 安装本目录（target = 绝对路径），
在侧栏点「小云雀」。

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
```

## 配置

`cliPath`、`cwd`、`downloadDir`、`teamId`、`stateTtlMs`——说明见
[detail/DETAIL.zh.md](detail/DETAIL.zh.md)。它们写在插件行上，改动不用重新构建。

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
