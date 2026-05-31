# 复刻 Android 开发文档到本地

## 下载menu.md中的目录依赖的所有资源
> 下载到docs-locate，得到offline-assets目录和page目录。做好代理，脚本会自动使用代理，整体大约1-2小时
```
node tools/localize-docs-batch.js
```

## 生成带目录的可读文档
```
node tools/build-readable-docs.js --output docs-locate\readable
```