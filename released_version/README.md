## 协同白板部署版

这个目录已经包含前端打包产物 `dist/` 以及最小化的 Node.js 服务，直接下载后即可运行。

### 快速使用

```bash
cd released_version
npm install
npm start
```

然后打开浏览器访问 `http://localhost:4000/`，页面会自动生成 `?boardId=xxxxxx`，把完整链接分享给其他人即可实时协作。

### 目录说明

```
released_version/
├─ dist/         # 已构建好的静态资源
├─ server.js     # Node.js 静态 + WebSocket 服务
├─ package.json  # 仅依赖 express + ws
└─ README.md
```

如果重新构建了前端，请将新的 `client/dist` 覆盖到这里的 `dist/`，重新提交即可。

