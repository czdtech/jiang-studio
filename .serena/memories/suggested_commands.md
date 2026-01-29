# 建议的开发命令

## 基本开发命令

### 项目启动
```bash
# 安装依赖
npm install

# 启动开发服务器 (端口 3000)
npm run dev

# 构建生产版本
npm run build

# 预览构建结果
npm run preview
```

### 环境配置
```bash
# 创建环境变量文件
touch .env.local

# 在 .env.local 中设置 Gemini API Key
echo "GEMINI_API_KEY=your_api_key_here" >> .env.local
```

## 系统工具命令 (macOS/Darwin)

### 文件操作
```bash
# 列出文件
ls -la

# 查找文件
find . -name "*.tsx" -type f

# 搜索文件内容
grep -r "searchterm" src/

# 复制文件
cp source.txt destination.txt

# 删除文件
rm filename.txt

# 创建目录
mkdir -p new/directory
```

### Git 操作
```bash
# 查看状态
git status

# 添加文件
git add .

# 提交更改
git commit -m "commit message"

# 推送到远程
git push origin main
```

### 进程管理
```bash
# 查看端口占用
lsof -i :3000

# 终止进程
kill -9 PID
```

## 开发工作流
1. 启动开发服务器: `npm run dev`
2. 在浏览器中访问 http://localhost:3000
3. 修改代码，Vite 会自动热重载
4. 构建前先运行 `npm run build` 检查是否有构建错误