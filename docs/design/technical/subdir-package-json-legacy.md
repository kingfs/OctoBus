# Subdirectory package.json Boundary

## 背景

多 service 根 npm 包方案把根 `package.json` 定义为 distribution package 的唯一
npm 控制面。service root 由子目录中的 `service.json` 标识。

service 子目录可以拥有自己的 `package.json`，但这些文件只服务于本地开发。在 npm
发布后的根包安装语义中，子目录不会自动成为独立 npm package，也不会自动安装自己的
dependencies、执行自己的 scripts 或暴露自己的 bin。

## 当前决策

OctoBus 不把子目录 `package.json` 纳入 import/runtime 契约。

具体规则：

- OctoBus import 只从子目录读取 `service.json`、proto、config schema 和 secret
  schema。
- runtime dependencies 只以根 `package.json` 为准。
- service runtime entry 只从根 `package.json bin` 中按 `service.json.name` 查找。
- 子目录 `package.json` 可以保留，但仅作为本地开发辅助文件。

这样可以避免一个 service 同时受到根 package 和子 package 两套 npm 规则控制。

## 为什么不能直接依赖子目录 package.json

npm workspace 只影响仓库开发安装，不会在消费者安装一个已发布根包时，把包内
子目录重新安装成 workspace package。

发布根包后：

- 根 `package.json` 是唯一 npm package manifest。
- 子目录 `package.json` 只是被打进 artifact 的普通文件。
- npm 不会自动安装子目录 dependencies。
- npm 不会自动注册子目录 bin。
- npm 不会自动执行子目录 scripts。

如果 OctoBus 在 runtime 中读取子目录 dependencies 或 bin，就会得到和 npm 安装
行为不一致的结果。

## 当前允许的用法

子目录 `package.json` 可以继续用于开发：

- 单独运行 service 子目录内的测试。
- 单独运行 SDK validate。
- 记录该 service 的开发依赖或脚本。
- 作为未来拆分独立 npm package 的准备。

根 package 可以通过 scripts 统一调用这些开发命令，例如：

```json
{
  "scripts": {
    "test": "npm --prefix chaitin__hanqing-ticket test",
    "validate": "npm --prefix chaitin__hanqing-ticket run validate"
  }
}
```

这些 scripts 是仓库开发约定，不是 OctoBus import/runtime 约定。

## 风险

保留子目录 `package.json` 会带来几个容易误解的点：

- 开发者可能以为子目录 dependencies 会随根包安装自动生效。
- 子目录 bin 可能和根 bin 不一致，导致本地运行和 OctoBus 运行入口不同。
- 子目录 SDK 版本可能和根 SDK 版本不一致。
- 子目录 lockfile 可能让人误以为它控制发布后的 runtime dependencies。

因此，文档和模板必须明确说明：根 `package.json` 是分发和 runtime 依赖的权威来源。

## 允许的演进方向

只要不改变“根 package 是唯一 distribution package”这一事实，仓库可以采用不同开发
组织方式：

- 移除子目录 `package.json`，把所有依赖、bin 和 scripts 收敛到根 package。
- 保留子目录 `package.json` 作为开发 manifest，并用校验保证 SDK 版本、入口命令和根
  package 保持一致。
- 引入 npm workspaces 管理本地开发依赖和 scripts，但发布后的 runtime 仍以根
  package 为准。

OctoBus 若要支持读取子目录 `package.json` 的 dependencies 或 bin，必须作为新的
package contract 重新设计 dependency install root、runtime `node_modules` 布局、
root/subdir bin 冲突处理和发布内容要求，不能成为隐式行为。
