# 代码风格和约定

## TypeScript 配置
- 目标版本: ES2022
- 模块系统: ESNext
- JSX: react-jsx
- 启用实验性装饰器
- 路径别名: `@/*` 映射到项目根目录

## 代码风格约定

### 命名约定
- **组件**: PascalCase (如 `EditorModal`, `ImageGrid`)
- **文件名**: PascalCase for components, camelCase for utilities
- **接口**: PascalCase with descriptive names (如 `GeneratedImage`, `ProviderProfile`)
- **枚举**: PascalCase (如 `ModelType`)
- **常量**: UPPER_SNAKE_CASE (如 `MODEL_PRESETS`)

### 文件组织
- 组件放在 `components/` 目录
- 业务逻辑放在 `services/` 目录
- React Hooks 放在 `hooks/` 目录
- 类型定义集中在 `types.ts`

### TypeScript 类型
- 使用接口定义对象结构
- 使用枚举定义固定选项
- 为所有函数参数和返回值添加类型注解
- 使用泛型提高代码复用性

### React 约定
- 使用函数组件和 Hooks
- Props 接口以组件名 + Props 命名
- 使用 React.useState 和 React.useEffect
- 组件内部状态管理使用 useState
- 复杂状态逻辑抽取为自定义 Hook

### 样式约定
- 使用 Tailwind CSS 进行样式设计
- 自定义颜色主题 (banana 色系 + dark 主题)
- 响应式设计优先
- 组件样式内联，避免外部 CSS 文件

### 错误处理
- 使用 try-catch 包装异步操作
- 提供有意义的错误消息
- 在 UI 中显示用户友好的错误提示

### 代码注释
- 为复杂逻辑添加中文注释
- 接口和类型定义添加 JSDoc 注释
- 重要的业务逻辑添加解释性注释